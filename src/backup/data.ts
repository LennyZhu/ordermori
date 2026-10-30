import { isNoticeLocale } from '../domain/noticeCopy.ts';
import { mergeQuotaEvidence, validateQuotaBackup } from './quota.ts';
import { validProductValues } from '../domain/catalog.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../data/migrations.ts';
import type { DatabasePort } from '../data/store.ts';
import { OrderStore } from '../data/store.ts';
import { evaluate, toInput } from '../domain/model.ts';
import type { Order, OrderDetail, OrderItem } from '../domain/model.ts';
import { normalizePayment } from '../domain/payment.ts';
import type { PaymentSnapshot } from '../domain/payment.ts';
import { failBackup, LIMITS } from './archive.ts';
import { schemaDiagnostic, schemaDifferences } from './schemaDiagnostics.ts';
import type { SchemaDiagnostic, SchemaDifference, SchemaEntry } from './schemaDiagnostics.ts';

export const TABLES = ['shops', 'app_state', 'orders', 'order_items', 'drafts', 'status_history', 'creation_ledger', 'payment_assets', 'payment_methods', 'shop_payment_defaults', 'order_payment_snapshots', 'notice_preferences', 'notice_files', 'backup_state', 'restore_receipts', 'catalog_products', 'quota_state', 'quota_events'] as const;
export type Table = typeof TABLES[number];
export type Row = Record<string, string | number | null>;
export type BackupData = Record<Table, Row[]>;
export interface MediaRef { path: string; size: number; sha256: string; width: number; height: number }
export interface BackupSummary { orders: number; items: number; media: number; createdCount: number; profileId: string; schemaVersion: number; products?: number; quotaPeriod?: string | null; quotaUsed?: number }
export interface SchemaObject { type: string; name: string; tbl_name: string; sql: string }
export const objects = (db: DatabasePort) => db.all<SchemaObject>("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name");
const schemaObjects = (db: DatabasePort) => db.all<SchemaEntry>('SELECT type,name,tbl_name,sql FROM main.sqlite_master ORDER BY name');
export async function createSchema(db: DatabasePort, version = SCHEMA_VERSION, early = false, brokenV4 = false, legacyNoticeGuards = false) {
  for (const m of MIGRATIONS.filter(m => m.version <= version)) {
    if (!(brokenV4 && m.version === 4)) await m.prepare?.(db);
    const sql = early && m.version === 3 ? m.sql.replace('note_snapshot TEXT NOT NULL, ', '') : m.sql;
    if (sql.trim()) await db.exec(sql);
    await db.exec(`PRAGMA user_version=${m.version}`);
  }
  // Reference DBs only: the observed early-v3 release had the UPDATE guard,
  // before INSERT/DELETE guards were added to the source of already-applied v3.
  // v4/v5 repair note_snapshot; v6 adds backup metadata, not these guards.
  if (legacyNoticeGuards && version >= 3) {
    await db.exec('DROP TRIGGER locked_notice_preferences_insert; DROP TRIGGER locked_notice_preferences_delete;');
  }
}
// A backup cannot supply executable schema. Match a schema built exclusively
// from shipped migrations (including the known early-v3/v4 compatibility path).
export async function checkSchema(db: DatabasePort, reference: () => Promise<{ db: DatabasePort; close(): Promise<void> }>, diagnose?: (report: SchemaDiagnostic) => void) {
  await db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON;');
  const version = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    diagnose?.(schemaDiagnostic(version,'version', [{type:'database',name:'user_version',tbl_name:'',rule:'unsupported_version',reason:'Database version is outside the supported migration range.'}]));
    failBackup('備份資料庫版本不支援；較新版本請先更新 App。');
  }
  // Include SQL-NULL internal indexes and match their identity/owner to trusted
  // references. Do not blanket-ignore sqlite_* or arbitrary SQL-NULL objects.
  const actual = await schemaObjects(db);
  if (actual.length > 100 || actual.some(o => o.sql !== null && o.sql.length > 30000)) {
    diagnose?.(schemaDiagnostic(version,'limits',[{type:'database',name:'sqlite_master',tbl_name:'',rule:'schema_limit',reason:'Schema object count or SQL length exceeds the limit.'}]));
    failBackup('備份資料庫結構不支援。');
  }
  const variants = [
    { name:'current',early:false,broken:false,legacy:false },
    { name:'early-v3-note-repaired',early:true,broken:false,legacy:false },
    ...(version === 4 ? [{ name:'early-v4-note-unrepaired',early:true,broken:true,legacy:false }] : []),
    // Only this exact observed historical guard set is accepted. Partial loss
    // of either guard, other missing guards or edited guard SQL still reject.
    ...(version >= 3 ? [{ name:'early-v3-original-guards',early:true,broken:false,legacy:true }] : []),
    ...(version === 4 ? [{ name:'early-v4-original-guards',early:true,broken:true,legacy:true }] : []),
  ];
  let nearest: { name:string; differences:SchemaDifference[] } | undefined;
  let currentDifferences: SchemaDifference[] = [];
  for (const variant of variants) {
    const ref = await reference();
    try {
      await createSchema(ref.db,version,variant.early,variant.broken,variant.legacy);
      const differences = schemaDifferences(actual,await schemaObjects(ref.db));
      if (variant.name === 'current') currentDifferences = differences;
      if (!differences.length) {
        if (variant.legacy) diagnose?.(schemaDiagnostic(version,variant.name,currentDifferences,'legacy-compatible','current'));
        return version;
      }
      if (!nearest || differences.length < nearest.differences.length) nearest = {name:variant.name,differences};
    } finally { await ref.close(); }
  }
  diagnose?.(schemaDiagnostic(version,nearest!.name,nearest!.differences));
  failBackup('備份含未知資料表、觸發器或不支援的結構；未執行備份 SQL。');
}
const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
function exactKeys(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) failBackup('備份設定包含不支援的欄位（不匯入購買權益）。');
}
const PAYMENT_KEYS = ['fpsType','fpsValue','bankName','accountName','accountNumber','qrAssetId','confirmed','version','methodId','shopId','kind','revision','confirmedAt'];
function paymentPayload(row: Row) {
  const p = JSON.parse(String(row.payload)) as PaymentSnapshot;
  exactKeys(p, row.id ? ['fpsType','fpsValue','bankName','accountName','accountNumber','qrAssetId','confirmed','confirmedAt'] : PAYMENT_KEYS);
  if (row.id) Object.assign(p, { version: 1, methodId: row.id, shopId: row.shop_id, kind: row.kind, revision: row.revision });
  normalizePayment(p.kind, p);
  if (p.version !== 1 || p.kind !== row.kind || p.shopId !== row.shop_id || !Number.isSafeInteger(p.revision) || p.revision < 1 || p.qrAssetId !== row.qr_asset_id || (row.id && p.methodId !== row.id) || (row.revision && p.revision !== row.revision) || (p.confirmed && !p.confirmedAt)) failBackup('備份收款快照不一致。');
  return p;
}
export async function readBackupData(db: DatabasePort): Promise<BackupData> {
  const integrity = await db.all<Record<string, string>>('PRAGMA integrity_check');
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok' || (await db.all('PRAGMA foreign_key_check')).length) failBackup('備份 SQLite 完整性或關聯校驗失敗。');
  const data = {} as BackupData; let rows = 0;
  for (const table of TABLES) {
    const count = await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
    rows += count!.n; if (rows > LIMITS.rows) failBackup('備份記錄超出目前可安全還原的上限。');
    data[table] = await db.all<Row>(`SELECT * FROM ${table}`);
    for (const row of data[table]) for (const value of Object.values(row)) {
      if (typeof value === 'number' && !Number.isSafeInteger(value)) failBackup('備份含非安全整數。');
      if (typeof value === 'string' && value.length > 500000) failBackup('備份文字資料過大。');
    }
  }
  validateData(data); return data;
}
export function validateData(data: BackupData): BackupSummary {
  if (data.shops.length !== 1 || data.app_state.length !== 1 || data.backup_state.length !== 1) failBackup('只支援完整的單店舖本機檔案。');
  const state = data.app_state[0], shop = data.shops[0];
  if (state.id !== 1 || state.active_shop_id !== shop.id || typeof state.profile_id !== 'string' || !state.profile_id || data.backup_state[0].id !== 1 || (data.backup_state[0].media_generation !== '' && !/^[a-f0-9-]{36}$/.test(String(data.backup_state[0].media_generation)))) failBackup('備份檔案設定無效。');
  for (const table of TABLES) for (const row of data[table]) if ('shop_id' in row && row.shop_id !== shop.id) failBackup('備份含不一致的店舖歸屬。');
  const allocated = data.creation_ledger.map(r => Number(r.allocated_number)).sort((a,b) => a-b);
  const newSince = (sequence: number) => {
    let lo=0, hi=allocated.length;
    while(lo<hi) { const mid=(lo+hi)>>>1; if(allocated[mid]<=sequence) lo=mid+1; else hi=mid; }
    return allocated.length-lo;
  };
  for (const r of data.restore_receipts) {
    if (![r.local_count,r.backup_count,r.retained_count,r.number_seq].every(integer) || r.retained_count !== Math.max(Number(r.local_count), Number(r.backup_count)) || Number(r.number_seq) < Number(r.retained_count)) failBackup('備份累計還原記錄無效。');
  }
  const receiptId = data.backup_state[0].usage_receipt_id;
  const basis = receiptId ? data.restore_receipts.find(r => r.id === receiptId) : undefined;
  if ((receiptId && !basis) || (!receiptId && data.restore_receipts.length)) failBackup('備份缺少目前累計用量的還原依據。');
  // Each replacement installs a new baseline. Old receipts from either profile
  // remain evidence, but their independent number sequences are not added.
  const expectedCount = basis ? Number(basis.retained_count) + newSince(Number(basis.number_seq)) : data.creation_ledger.length;
  const maxSeq = Math.max(0, ...data.creation_ledger.map(r => Number(r.allocated_number)), ...data.restore_receipts.map(r => Number(r.number_seq)));
  if (!integer(state.created_count) || !integer(state.order_number_seq) || state.created_count !== expectedCount || Number(state.order_number_seq) < Math.max(Number(state.created_count), maxSeq) || data.creation_ledger.length !== data.orders.length) failBackup('備份累計用量與建立記錄無法校驗；未重設額度。');
  const itemsByOrder = new Map<string, Row[]>();
  for (const item of data.order_items) { const key=String(item.order_id); const group=itemsByOrder.get(key) ?? []; group.push(item); itemsByOrder.set(key,group); }
  const ledgerByOrder = new Map(data.creation_ledger.map(l => [l.order_id,l]));
  for (const order of data.orders) {
    const items = (itemsByOrder.get(String(order.id)) ?? []).sort((a,b) => Number(a.position)-Number(b.position));
    const ledger = ledgerByOrder.get(order.id);
    if (!ledger || !integer(ledger.allocated_number) || Number(ledger.allocated_number) < 1 || order.order_number !== `OM-${String(ledger.allocated_number).padStart(6,'0')}` || items.some((item,i) => item.position !== i || item.line_total_cents !== Number(item.unit_price_cents) * Number(item.quantity))) failBackup('備份訂單編號、建立記錄或商品順序不一致。');
    const detail = { order: order as unknown as Order, items: items as unknown as OrderItem[], history: [], payment: null } satisfies OrderDetail;
    const calculated = evaluate(toInput(detail));
    if (calculated.total !== order.total_cents || calculated.subtotal !== order.subtotal_cents || calculated.shipping !== order.shipping_cents || calculated.discount !== order.discount_cents) failBackup('備份訂單金額校驗失敗。');
  }
  for (const row of [...data.payment_methods, ...data.order_payment_snapshots]) paymentPayload(row);
  for (const row of data.drafts) {
    const draft = JSON.parse(String(row.payload)); exactKeys(draft, ['version','input']);
    if (draft.version !== 1 || !draft.input || !Array.isArray(draft.input.items) || draft.input.items.length > 20) failBackup('備份草稿格式不支援。');
    exactKeys(draft.input, ['buyer','items','shipping','shippingFee','discount','note','payment','paymentChosen']);
    for (const item of draft.input.items) { exactKeys(item, ['id','name','price','quantity']); if (!['id','name','price','quantity'].every(k => typeof item[k] === 'string')) failBackup('備份草稿商品無效。'); }
    if (!['buyer','shipping','shippingFee','discount','note'].every(k => typeof draft.input[k] === 'string')) failBackup('備份草稿資料無效。');
    if (draft.input.payment) { exactKeys(draft.input.payment, PAYMENT_KEYS); normalizePayment(draft.input.payment.kind, draft.input.payment); if (draft.input.payment.shopId !== shop.id) failBackup('草稿收款歸屬無效。'); }
  }
  for (const product of data.catalog_products) if (!validProductValues(product.name,product.unit_price_cents) || !Number.isSafeInteger(product.revision) || Number(product.revision) < 1) failBackup('備份常用商品名稱或單價無效。');
  for (const row of data.notice_preferences) if (!isNoticeLocale(row.output_locale)) failBackup('備份付款通知語言無效。');
  for (const row of data.notice_files) if (!isNoticeLocale(row.locale)) failBackup('備份付款通知語言無效。');
  validateQuotaBackup(data.quota_state, data.quota_events, data.orders);
  const media = mediaReferences(data);
  const quotaPeriod = data.quota_state[0].highest_period as string | null;
  return { orders: data.orders.length, items: data.order_items.length, media: media.length, createdCount: Number(state.created_count), profileId: String(state.profile_id), schemaVersion: SCHEMA_VERSION, products: data.catalog_products.length, quotaPeriod, quotaUsed: quotaPeriod ? data.quota_events.filter(e => e.period === quotaPeriod).length : 0 };
}
export function mediaReferences(data: BackupData): MediaRef[] {
  for (const r of data.payment_assets) if (!['image/png','image/jpeg'].includes(String(r.mime)) || r.relative_path !== `payment-assets/${r.id}.${r.mime === 'image/png' ? 'png' : 'jpg'}` || Number(r.byte_count) > 20*1024*1024 || Number(r.width)*Number(r.height)>40000000 || Math.max(Number(r.width),Number(r.height))>12000) failBackup('備份收款圖片記錄無效。');
  for (const r of data.notice_files) if (r.relative_path !== `payment-notices/${r.id}.png` || r.width !== 1080 || Number(r.height)*1080*12 > 256*1024*1024 || !/^[a-f0-9]{64}$/.test(String(r.data_hash))) failBackup('備份 PNG 記錄無效。');
  const refs = [...data.payment_assets.map(r => ({ path: String(r.relative_path), size: Number(r.byte_count), sha256: String(r.sha256), width: Number(r.width), height: Number(r.height) })), ...data.notice_files.map(r => ({ path: String(r.relative_path), size: Number(r.byte_count), sha256: String(r.sha256), width: Number(r.width), height: Number(r.height) }))];
  const names = new Set(); let size = 0;
  for (const r of refs) { if (names.has(r.path) || !/^(payment-assets\/[a-f0-9-]{36}\.(png|jpg)|payment-notices\/[a-f0-9-]{36}\.png)$/.test(r.path) || !integer(r.size) || r.size < 1 || r.size > LIMITS.file || !/^[a-f0-9]{64}$/.test(r.sha256) || !integer(r.width) || !integer(r.height) || !r.width || !r.height) failBackup('備份圖片記錄不完整或路徑無效。'); names.add(r.path); size += r.size; }
  if (size > LIMITS.total || refs.length + 2 > LIMITS.files) failBackup('備份圖片數量或總大小超出限制。');
  return refs;
}
export async function migrateInspected(db: DatabasePort) {
  await db.exec('PRAGMA query_only=OFF; PRAGMA foreign_keys=ON;');
  await new OrderStore(db, () => failBackup('備份缺少原有本機檔案，未建立空白資料。')).initialize({ activateQuota: false });
}
// Only trusted triggers from the ACTIVE app schema are temporarily removed,
// inside the same transaction. This allows insertion of already-paid history.
// Rollback restores both schema and old data, including counter/lock triggers.
export async function replaceData(db: DatabasePort, imported: BackupData, generation: string, id: string, now: string, afterRows?: () => Promise<void>) {
  if (!/^[a-f0-9-]{36}$/.test(generation)) failBackup('還原暫存目錄無效。');
  validateData(imported);
  await db.exec('BEGIN IMMEDIATE');
  try {
    const current = await readBackupData(db), local = current.app_state[0], incoming = imported.app_state[0];
    const count = Math.max(Number(local.created_count), Number(incoming.created_count));
    const seq = Math.max(Number(local.order_number_seq), Number(incoming.order_number_seq));
    const receipt: Row = { id, source_profile_id: incoming.profile_id, local_count: local.created_count, backup_count: incoming.created_count, retained_count: count, number_seq: seq, restored_at: now };
    const merged = new Map([...imported.restore_receipts, ...current.restore_receipts].map(r => [String(r.id), r])); merged.set(id, receipt);
    const quota = mergeQuotaEvidence(current.quota_state[0], current.quota_events, imported.quota_state[0], imported.quota_events, now);
    const data: BackupData = { ...imported, ...quota, app_state: [{ ...incoming, profile_id: local.profile_id, created_count: count, order_number_seq: seq }], backup_state: [{ id: 1, usage_receipt_id: id, media_generation: generation, last_created_at: current.backup_state[0].last_created_at }], restore_receipts: [...merged.values()] };
    validateData(data);
    const triggers = (await objects(db)).filter(o => o.type === 'trigger');
    await db.exec('PRAGMA defer_foreign_keys=ON;');
    for (const t of triggers) { if (!/^[a-z_]+$/.test(t.name)) failBackup('本機觸發器名稱無效。'); await db.exec(`DROP TRIGGER ${t.name}`); }
    for (const table of [...TABLES].reverse()) await db.exec(`DELETE FROM ${table}`);
    for (const table of TABLES) for (const row of data[table]) {
      const columns = Object.keys(row); if (columns.some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) failBackup('備份欄位名稱無效。');
      await db.run(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map(c => row[c]));
    }
    for (const t of triggers) await db.exec(t.sql);
    await readBackupData(db); await afterRows?.();
    await db.exec('COMMIT');
  } catch (error) {
    try { await db.exec('ROLLBACK'); }
    catch {
      const committed = await db.first<{ media_generation:string }>('SELECT media_generation FROM backup_state WHERE id=1');
      if (committed?.media_generation === generation) { await readBackupData(db); return; }
    }
    throw error;
  }
}
