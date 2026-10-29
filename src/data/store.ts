import { MIGRATIONS, SCHEMA_VERSION } from './migrations.ts';
import { DomainError, FREE_LIMIT, blankInput, countChars, editable, evaluate, transition } from '../domain/model.ts';
import type { Action, Draft, Filter, History, HomeData, Order, OrderDetail, OrderInput, OrderItem, Shop } from '../domain/model.ts';
import { isPaymentKind, normalizePayment, paymentStatus, snapshotOf } from '../domain/payment.ts';
import type { PaymentAsset, PaymentChoice, PaymentInput, PaymentKind, PaymentMethod, PaymentSettings, PaymentSnapshot, QrState } from '../domain/payment.ts';
import { buildNotice, defaultNoticePreferences, noticeSourceKey, NOTICE_TEMPLATES } from '../domain/notice.ts';
import type { NoticeContext, NoticeFileRecord, NoticePreferences } from '../domain/notice.ts';
import { noticeFailure, NoticeStageError } from '../domain/noticeDiagnostics.ts';
import type { NoticeStage } from '../domain/noticeDiagnostics.ts';
import { noticeSchemaDiagnostic } from './noticeCompatibility.ts';

type Binding = string | number | null;
export interface DatabasePort {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: Binding[]): Promise<{ changes: number }>;
  first<T>(sql: string, params?: Binding[]): Promise<T | null>;
  all<T>(sql: string, params?: Binding[]): Promise<T[]>;
}
interface State { active_shop_id: string; created_count: number; order_number_seq: number }
interface DraftRow { shop_id: string; request_id: string; edit_seq: number; payload: string; is_active: number }
interface PaymentRow { id: string; shop_id: string; kind: PaymentKind; payload: string; revision: number; updated_at: string }
interface AssetRow { id: string; shop_id: string; kind: 'fps' | 'payme'; relative_path: string; mime: PaymentAsset['mime']; byte_count: number; sha256: string; width: number; height: number }

export class OrderStore {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private db: DatabasePort;
  private newId: () => string;
  private now: () => string;
  private verifyAsset: (asset: PaymentAsset) => Promise<QrState>;
  constructor(db: DatabasePort, newId: () => string, now: () => string = () => new Date().toISOString(), verifyAsset: (asset: PaymentAsset) => Promise<QrState> = async () => 'missing') {
    this.db = db; this.newId = newId; this.now = now;
    this.verifyAsset = verifyAsset;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach((listener) => listener()); }
  // This private connection is never exposed: ALL reads and writes enter this queue.
  // No asynchronous query can accidentally enter another operation's transaction.
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async atomic<T>(work: () => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work();
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private async state() {
    const state = await this.db.first<State>('SELECT * FROM app_state WHERE id=1');
    if (!state) throw new DomainError('data', '本機檔案設定不完整，未清除任何資料。');
    return state;
  }
  async initialize() {
    return this.enqueue(async () => {
      await this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const version = (await this.db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
      if (version > SCHEMA_VERSION) throw new DomainError('version', '此資料由較新版本建立，請更新 App；不會重建或刪除資料。');
      let applyingNoticeMigration = false;
      await this.atomic(async () => {
        for (const migration of MIGRATIONS) if (migration.version > version) {
          if (migration.version >= 3) applyingNoticeMigration = true;
          if (migration.prepare) await migration.prepare(this.db);
          if (migration.sql.trim()) await this.db.exec(migration.sql);
          await this.db.exec(`PRAGMA user_version=${migration.version}`);
        }
        if (!await this.db.first('SELECT id FROM app_state WHERE id=1')) {
          if (version !== 0) throw new DomainError('data', '既有本機檔案設定缺失；不會重設店舖或免費額度。');
          const shopId = this.newId();
          await this.db.run('INSERT INTO shops(id,name,description,updated_at) VALUES(?,?,?,?)', [shopId, '', '', this.now()]);
          await this.db.run('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)', [this.newId(), shopId]);
        }
      }).catch(async (cause: unknown) => {
        if (!applyingNoticeMigration) throw cause;
        const schema = await noticeSchemaDiagnostic(this.db).catch(() => undefined);
        throw noticeFailure(cause instanceof DomainError && cause.code === 'notice_schema' ? 'schema-check' : 'migration', null, cause, schema);
      });
    });
  }
  async getShop() {
    return this.enqueue(async () => {
      const state = await this.state();
      return (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))!;
    });
  }
  async saveShop(name: string, description: string) {
    if (!name.trim() || countChars(name.trim()) > 80) throw new DomainError('validation', '請填寫 1 至 80 個字符的店舖名稱。');
    if (countChars(description) > 500) throw new DomainError('validation', '店舖簡介最多 500 個字符。');
    return this.enqueue(async () => {
      const state = await this.state();
      await this.db.run('UPDATE shops SET name=?,description=?,updated_at=? WHERE id=?', [name.trim(), description, this.now(), state.active_shop_id]);
      this.emit();
    });
  }
  private paymentFromRow(row: PaymentRow): PaymentSnapshot {
    const payload = JSON.parse(row.payload) as PaymentInput & { confirmedAt: string | null };
    return { ...normalizePayment(row.kind, payload), version: 1, methodId: row.id, shopId: row.shop_id, kind: row.kind,
      revision: row.revision, confirmedAt: payload.confirmedAt };
  }
  private async assetById(id: string, shopId: string, kind: PaymentKind): Promise<PaymentAsset | null> {
    const row = await this.db.first<AssetRow>('SELECT * FROM payment_assets WHERE id=? AND shop_id=? AND kind=?', [id, shopId, kind]);
    return row ? { id: row.id, shopId: row.shop_id, kind: row.kind, relativePath: row.relative_path, mime: row.mime,
      bytes: row.byte_count, sha256: row.sha256, width: row.width, height: row.height } : null;
  }
  private async paymentChoice(snapshot: PaymentSnapshot): Promise<PaymentChoice> {
    const asset = snapshot.qrAssetId ? await this.assetById(snapshot.qrAssetId, snapshot.shopId, snapshot.kind) : null;
    let qrState: QrState = snapshot.qrAssetId ? 'missing' : 'none';
    if (asset) { try { qrState = await this.verifyAsset(asset); } catch { qrState = 'invalid'; } }
    return { snapshot, asset, qrState, status: paymentStatus(snapshot.kind, snapshot, qrState) };
  }
  async getPaymentSettings(): Promise<PaymentSettings> {
    return this.enqueue(async () => {
      const state = await this.state();
      const rows = await this.db.all<PaymentRow>('SELECT * FROM payment_methods WHERE shop_id=? ORDER BY kind', [state.active_shop_id]);
      const methods: PaymentMethod[] = [];
      for (const row of rows) {
        const choice = await this.paymentChoice(this.paymentFromRow(row));
        methods.push({ ...choice.snapshot, updatedAt: row.updated_at, qrState: choice.qrState, status: choice.status });
      }
      const defaultRow = await this.db.first<{ method_id: string }>('SELECT method_id FROM shop_payment_defaults WHERE shop_id=?', [state.active_shop_id]);
      return { methods, defaultMethodId: defaultRow?.method_id ?? null };
    });
  }
  async registerPaymentAsset(asset: PaymentAsset) {
    return this.enqueue(async () => {
      const state = await this.state();
      if (asset.shopId !== state.active_shop_id || !['fps', 'payme'].includes(asset.kind) ||
        !/^payment-assets\/[a-f0-9-]{36}\.(png|jpg)$/.test(asset.relativePath) || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !['image/png', 'image/jpeg'].includes(asset.mime) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 20 * 1024 * 1024 ||
        !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0 || Math.max(asset.width, asset.height) > 12000 || asset.width * asset.height > 40000000 ||
        asset.relativePath !== `payment-assets/${asset.id}.${asset.mime === 'image/png' ? 'png' : 'jpg'}`) {
        throw new DomainError('asset', '收款圖片資料不完整或不屬於這間店舖。');
      }
      if (await this.verifyAsset(asset) !== 'available') throw new DomainError('asset', '收款圖片未能完整保存，未變更原有設定。');
      await this.db.run('INSERT INTO payment_assets(id,shop_id,kind,relative_path,mime,byte_count,sha256,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
        [asset.id, asset.shopId, asset.kind, asset.relativePath, asset.mime, asset.bytes, asset.sha256, asset.width, asset.height, this.now()]);
    });
  }
  async savePaymentMethod(kind: PaymentKind, input: PaymentInput, expectedRevision?: number | null) {
    const value = normalizePayment(kind, input);
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const state = await this.state();
        const old = await this.db.first<PaymentRow>('SELECT * FROM payment_methods WHERE shop_id=? AND kind=?', [state.active_shop_id, kind]);
        if (expectedRevision !== undefined && (old?.revision ?? null) !== expectedRevision) throw new DomainError('conflict', '收款設定已更新，請返回列表重新開啟。');
        if (value.qrAssetId && !await this.assetById(value.qrAssetId, state.active_shop_id, kind)) throw new DomainError('asset', '圖片不屬於此收款方式，未變更設定。');
        const now = this.now();
        await this.db.run(`INSERT INTO payment_methods(id,shop_id,kind,payload,qr_asset_id,revision,updated_at) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(shop_id,kind) DO UPDATE SET payload=excluded.payload,qr_asset_id=excluded.qr_asset_id,revision=excluded.revision,updated_at=excluded.updated_at`,
        [old?.id ?? this.newId(), state.active_shop_id, kind, JSON.stringify({ ...value, confirmedAt: value.confirmed ? now : null }), value.qrAssetId, (old?.revision ?? 0) + 1, now]);
      });
      this.emit();
    });
  }
  async setDefaultPaymentMethod(methodId: string | null) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const state = await this.state();
        if (methodId === null) { await this.db.run('DELETE FROM shop_payment_defaults WHERE shop_id=?', [state.active_shop_id]); return; }
        const row = await this.db.first<PaymentRow>('SELECT * FROM payment_methods WHERE id=? AND shop_id=?', [methodId, state.active_shop_id]);
        if (!row || (await this.paymentChoice(this.paymentFromRow(row))).status !== 'ready') throw new DomainError('payment', '請先完成並核對收款資料，再設為預設。');
        await this.db.run('INSERT INTO shop_payment_defaults(shop_id,method_id) VALUES(?,?) ON CONFLICT(shop_id) DO UPDATE SET method_id=excluded.method_id', [state.active_shop_id, methodId]);
      });
      this.emit();
    });
  }
  async inspectPayment(snapshot: PaymentSnapshot): Promise<PaymentChoice> {
    return this.enqueue(async () => {
      const state = await this.state();
      if (snapshot.version !== 1 || snapshot.shopId !== state.active_shop_id || !isPaymentKind(snapshot.kind)) throw new DomainError('payment', '收款資料格式或店舖歸屬不一致，未覆寫原資料。');
      return this.paymentChoice(snapshotOf(snapshot));
    });
  }
  private async saveOrderPayment(orderId: string, shopId: string, selection: PaymentSnapshot | null | undefined) {
    // Undefined is a legacy input: preserve its existing snapshot, if any.
    if (selection === undefined) return;
    if (selection === null) { await this.db.run('DELETE FROM order_payment_snapshots WHERE order_id=? AND shop_id=?', [orderId, shopId]); return; }
    if (selection.version !== 1 || selection.shopId !== shopId || !isPaymentKind(selection.kind) || !Number.isSafeInteger(selection.revision) || selection.revision < 1 ||
      (selection.confirmed && (typeof selection.confirmedAt !== 'string' || !selection.confirmedAt))) throw new DomainError('payment', '所選收款資料不完整，請重新選擇。');
    const method = await this.db.first<PaymentRow>('SELECT * FROM payment_methods WHERE id=? AND shop_id=? AND kind=?', [selection.methodId, shopId, selection.kind]);
    if (!method || method.revision < selection.revision) throw new DomainError('payment', '找不到所選收款設定，請重新選擇。');
    const snapshot = snapshotOf(selection);
    if (snapshot.qrAssetId && !await this.assetById(snapshot.qrAssetId, shopId, snapshot.kind)) throw new DomainError('asset', '收款圖片歸屬不一致。');
    await this.db.run(`INSERT INTO order_payment_snapshots(order_id,shop_id,kind,payload,qr_asset_id) VALUES(?,?,?,?,?)
      ON CONFLICT(order_id) DO UPDATE SET kind=excluded.kind,payload=excluded.payload,qr_asset_id=excluded.qr_asset_id`,
    [orderId, shopId, snapshot.kind, JSON.stringify(snapshot), snapshot.qrAssetId]);
  }
  private async noticeContext(id: string): Promise<NoticeContext> {
    const order = await this.ownedOrder(id);
    const row = await this.db.first<{ payload: string }>('SELECT payload FROM order_payment_snapshots WHERE order_id=? AND shop_id=?', [id, order.shop_id]);
    const payment = row ? JSON.parse(row.payload) as PaymentSnapshot : null;
    const preferences = await this.db.first<{ template: NoticePreferences['template']; locale: 'zh-HK'; include_note: number; note_snapshot: string; revision: number }>('SELECT * FROM notice_preferences WHERE order_id=? AND shop_id=?', [id, order.shop_id]);
    return { detail: { order, payment, items: await this.db.all<OrderItem>('SELECT * FROM order_items WHERE order_id=? AND shop_id=? ORDER BY position', [id, order.shop_id]), history: [] },
      payment: payment ? await this.paymentChoice(payment) : null,
      preferences: preferences ? { template: preferences.template, locale: preferences.locale, includeNote: !!preferences.include_note, noteSnapshot: preferences.note_snapshot, revision: preferences.revision } : defaultNoticePreferences() };
  }
  async getNoticeContext(id: string) {
    return this.enqueue(() => this.noticeContext(id).catch((cause: unknown) => { throw new NoticeStageError('settings-read', cause); }));
  }
  async saveNoticePreferences(id: string, orderRevision: number, expected: number, input: Pick<NoticePreferences, 'template' | 'includeNote'> & { confirmedNote?: string }) {
    return this.enqueue(async () => {
      let stage: NoticeStage = 'settings-transaction';
      try { return await this.atomic(async () => {
        stage = 'settings-read';
        const context = await this.noticeContext(id);
        if (context.detail.order.revision !== orderRevision || context.preferences.revision !== expected) throw new DomainError('conflict', '訂單或通知設定已更新，請重新開啟。');
        if (!editable(context.detail.order)) throw new DomainError('locked', '對外快照已鎖定，不能改寫通知設定。');
        if (!NOTICE_TEMPLATES.includes(input.template) || typeof input.includeNote !== 'boolean') throw new DomainError('notice', '通知設定無效。');
        if (input.confirmedNote !== undefined && (!input.includeNote || input.confirmedNote !== context.detail.order.note)) throw new DomainError('conflict', '備註已改變，請重新核對是否提供給客人。');
        if (input.includeNote && !context.preferences.includeNote && input.confirmedNote === undefined) throw new DomainError('notice', '請先明確確認客戶可見備註。');
        const noteSnapshot = input.includeNote ? input.confirmedNote ?? context.preferences.noteSnapshot : '';
        stage = 'settings-write';
        await this.db.run(`INSERT INTO notice_preferences(order_id,shop_id,template,locale,include_note,note_snapshot,revision) VALUES(?,?,?,'zh-HK',?,?,?)
          ON CONFLICT(order_id) DO UPDATE SET template=excluded.template,include_note=excluded.include_note,note_snapshot=excluded.note_snapshot,revision=excluded.revision`,
        [id, context.detail.order.shop_id, input.template, input.includeNote ? 1 : 0, noteSnapshot, expected + 1]);
        stage = 'settings-commit';
      }); } catch (cause) {
        const schema = await noticeSchemaDiagnostic(this.db).catch(() => undefined);
        throw noticeFailure(stage, input.template, cause, schema);
      }
    });
  }
  async completeNoticeShopSnapshot(id: string, expected: number, confirmed: Pick<Shop, 'name' | 'description'>) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const order = await this.ownedOrder(id); const shop = await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [order.shop_id]);
        if (!editable(order) || order.revision !== expected || order.shop_name_snapshot.trim()) throw new DomainError('locked', '只可明確補齊仍可編輯、且缺少名稱的訂單；原有快照未變更。');
        if (!shop?.name.trim()) throw new DomainError('notice', '請先到我的店舖儲存名稱。');
        if (shop.name !== confirmed.name || shop.description !== confirmed.description) throw new DomainError('conflict', '店舖資料已改變，請重新核對後再補齊快照。');
        await this.db.run('UPDATE orders SET shop_name_snapshot=?,shop_description_snapshot=?,updated_at=?,revision=revision+1 WHERE id=?', [shop.name, shop.description, this.now(), id]);
      }); this.emit();
    });
  }
  async recordNoticeFile(file: NoticeFileRecord, sourceKey: string, active: () => boolean = () => true) {
    return this.enqueue(async () => this.atomic(async () => {
      const document = buildNotice(await this.noticeContext(file.orderId));
      if (!active()) throw new DomainError('notice', '已離開頁面或 App 不在前景，未保存此次輸出。');
      if (noticeSourceKey(document) !== sourceKey || file.shopId !== document.shopId || file.orderRevision !== document.orderRevision || file.preferencesRevision !== document.preferencesRevision || file.template !== document.template) throw new DomainError('conflict', '產生期間訂單或通知設定已改變，未保存過期圖片。');
      if (!/^[a-f0-9-]{36}$/.test(file.id) || file.relativePath !== `payment-notices/${file.id}.png` || file.width !== 1080 || !Number.isSafeInteger(file.height) || file.height <= 0 || file.width * file.height * 12 > 256 * 1024 * 1024 || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{64}$/.test(file.dataHash) || !Number.isFinite(Date.parse(file.createdAt))) throw new DomainError('notice', '付款通知檔案資料無效。');
      await this.db.run(`INSERT INTO notice_files(id,order_id,shop_id,order_revision,preferences_revision,template,relative_path,width,height,byte_count,sha256,data_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [file.id, file.orderId, file.shopId, file.orderRevision, file.preferencesRevision, file.template, file.relativePath, file.width, file.height, file.bytes, file.sha256, file.dataHash, file.createdAt]);
    }));
  }
  async listNoticeFiles(id: string): Promise<NoticeFileRecord[]> {
    return this.enqueue(async () => {
      const order = await this.ownedOrder(id);
      const rows = await this.db.all<{ id: string; order_id: string; shop_id: string; order_revision: number; preferences_revision: number; template: NoticeFileRecord['template']; relative_path: string; width: number; height: number; byte_count: number; sha256: string; data_hash: string; created_at: string }>('SELECT * FROM notice_files WHERE order_id=? AND shop_id=? ORDER BY created_at DESC,rowid DESC', [id, order.shop_id]);
      return rows.map((r) => ({ id: r.id, orderId: r.order_id, shopId: r.shop_id, orderRevision: r.order_revision, preferencesRevision: r.preferences_revision, template: r.template, relativePath: r.relative_path, width: r.width, height: r.height, bytes: r.byte_count, sha256: r.sha256, dataHash: r.data_hash, createdAt: r.created_at }));
    });
  }
  async removeNoticeFile(id: string, fileId: string) {
    return this.enqueue(async () => { const order = await this.ownedOrder(id); await this.db.run('DELETE FROM notice_files WHERE id=? AND order_id=? AND shop_id=?', [fileId, id, order.shop_id]); });
  }
  async getHome(search = '', filter: Filter = 'all'): Promise<HomeData> {
    return this.enqueue(async () => {
      const state = await this.state();
      const clauses: Record<Filter, string> = {
        all: '1=1', unpaid: "order_status='active' AND payment_status='unpaid' AND fulfillment_status='pending'",
        fulfillment: "order_status='active' AND payment_status='paid' AND fulfillment_status='pending'",
        completed: "order_status='active' AND payment_status='paid' AND fulfillment_status!='pending'",
        refunded: "payment_status='refunded'", cancelled: "order_status='cancelled'",
      };
      const escaped = search.trim().replace(/[\\%_]/g, '\\$&');
      const orders = await this.db.all<Order>(`SELECT * FROM orders WHERE shop_id=? AND (${clauses[filter]}) AND (buyer_identifier LIKE ? ESCAPE '\\' OR order_number LIKE ? ESCAPE '\\') ORDER BY created_at DESC,order_number DESC`, [state.active_shop_id, `%${escaped}%`, `%${escaped}%`]);
      const counts = await this.db.first<{ unpaid: number; fulfillment: number }>(`SELECT
        COALESCE(SUM(CASE WHEN order_status='active' AND payment_status='unpaid' AND fulfillment_status='pending' THEN 1 ELSE 0 END),0) AS unpaid,
        COALESCE(SUM(CASE WHEN order_status='active' AND payment_status='paid' AND fulfillment_status='pending' THEN 1 ELSE 0 END),0) AS fulfillment
        FROM orders WHERE shop_id=?`, [state.active_shop_id]);
      return { orders, unpaid: counts!.unpaid, fulfillment: counts!.fulfillment, createdCount: state.created_count,
        hasDraft: !!await this.db.first('SELECT id FROM drafts WHERE id=1 AND is_active=1 AND shop_id=?', [state.active_shop_id]),
        shop: (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))! };
    });
  }
  // Read-only homepage projection; never opens, creates or updates a draft.
  async getDraftInput(): Promise<OrderInput | null> {
    return this.enqueue(async () => {
      const state = await this.state();
      const row = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1 AND shop_id=?', [state.active_shop_id]);
      if (!row) return null;
      const parsed = JSON.parse(row.payload) as { version: number; input: OrderInput };
      if (parsed.version !== 1 || !Array.isArray(parsed.input?.items)) throw new DomainError('draft', '草稿格式不支援，未覆寫原資料。');
      return parsed.input;
    });
  }
  async openDraft(): Promise<Draft> {
    return this.enqueue(async () => this.atomic(async () => {
      const state = await this.state();
      const row = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1');
      if (row) {
        if (row.shop_id !== state.active_shop_id) throw new DomainError('shop', '草稿店舖歸屬不一致。');
        const parsed = JSON.parse(row.payload) as { version: number; input: OrderInput };
        if (parsed.version !== 1 || !Array.isArray(parsed.input?.items)) throw new DomainError('draft', '草稿格式不支援，未覆寫原資料。');
        return { requestId: row.request_id, shopId: row.shop_id, editSeq: row.edit_seq, input: parsed.input };
      }
      if (state.created_count >= FREE_LIMIT) throw new DomainError('quota', 'Free 累計 10 張訂單已用完。Pro 購買尚未開放，已有訂單仍可管理。');
      const draft = { requestId: this.newId(), shopId: state.active_shop_id, editSeq: 0, input: blankInput(this.newId()) };
      const defaultRow = await this.db.first<PaymentRow>('SELECT m.* FROM payment_methods m JOIN shop_payment_defaults d ON d.method_id=m.id AND d.shop_id=m.shop_id WHERE m.shop_id=?', [state.active_shop_id]);
      const defaultChoice = defaultRow ? await this.paymentChoice(this.paymentFromRow(defaultRow)) : null;
      draft.input.payment = defaultChoice?.status === 'ready' ? defaultChoice.snapshot : null;
      await this.db.run(`INSERT INTO drafts(id,shop_id,request_id,edit_seq,payload,is_active,updated_at) VALUES(1,?,?,0,?,1,?)
        ON CONFLICT(id) DO UPDATE SET shop_id=excluded.shop_id,request_id=excluded.request_id,edit_seq=0,payload=excluded.payload,is_active=1,updated_at=excluded.updated_at`,
      [draft.shopId, draft.requestId, JSON.stringify({ version: 1, input: draft.input }), this.now()]);
      this.emit(); return draft;
    }));
  }
  async saveDraft(requestId: string, editSeq: number, input: OrderInput) {
    return this.enqueue(async () => {
      const state = await this.state();
      const result = await this.db.run('UPDATE drafts SET payload=?,edit_seq=?,updated_at=? WHERE id=1 AND request_id=? AND shop_id=? AND is_active=1 AND edit_seq<=?',
        [JSON.stringify({ version: 1, input }), editSeq, this.now(), requestId, state.active_shop_id, editSeq]);
      if (result.changes) this.emit();
      return result.changes > 0;
    });
  }
  async discardDraft(requestId: string) {
    return this.enqueue(async () => {
      await this.db.run('UPDATE drafts SET is_active=0 WHERE id=1 AND request_id=?', [requestId]); this.emit();
    });
  }
  private async insertItems(orderId: string, shopId: string, input: ReturnType<typeof evaluate>) {
    for (const [position, item] of input.items.entries()) await this.db.run(`INSERT INTO order_items(id,order_id,shop_id,position,name_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)`,
      [this.newId(), orderId, shopId, position, item.name, item.quantity, item.price, item.lineTotal]);
  }
  async createOrder(requestId: string, input: OrderInput): Promise<string> {
    return this.enqueue(async () => {
      const id = await this.atomic(async () => {
        const state = await this.state();
        const existing = await this.db.first<Order>('SELECT * FROM orders WHERE creation_request_id=? AND shop_id=?', [requestId, state.active_shop_id]);
        if (existing) return existing.id;
        const active = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1 AND request_id=? AND shop_id=?', [requestId, state.active_shop_id]);
        if (!active) throw new DomainError('draft', '草稿已轉換或關閉，請返回訂單列表。');
        const values = evaluate(input);
        if (state.created_count >= FREE_LIMIT) throw new DomainError('quota', 'Free 累計 10 張訂單已用完；未建立或扣除任何新訂單。');
        const ordinal = state.order_number_seq + 1;
        if (!Number.isSafeInteger(ordinal)) throw new DomainError('number', '訂單編號已超出安全範圍。');
        const orderId = this.newId(); const now = this.now();
        const shop = (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))!;
        await this.db.run(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,
          order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,'active','unpaid','pending',?,?,?,?,?,?,?,?)`,
        [orderId, shop.id, `OM-${String(ordinal).padStart(6, '0')}`, requestId, values.buyer, shop.name, shop.description,
          values.shippingMethod, values.subtotal, values.discount, values.shipping, values.total, values.note, now, now]);
        await this.insertItems(orderId, shop.id, values);
        await this.saveOrderPayment(orderId, shop.id, input.payment);
        await this.db.run('INSERT INTO creation_ledger(event_id,order_id,allocated_number,created_at) VALUES(?,?,?,?)', [this.newId(), orderId, ordinal, now]);
        await this.db.run("INSERT INTO status_history(id,order_id,shop_id,axis,from_value,to_value,reason,recorded_at) VALUES(?,?,?,'order','draft','active','明確儲存建立訂單',?)", [this.newId(), orderId, shop.id, now]);
        await this.db.run('UPDATE app_state SET created_count=created_count+1,order_number_seq=? WHERE id=1', [ordinal]);
        await this.db.run('UPDATE drafts SET is_active=0 WHERE id=1 AND request_id=?', [requestId]);
        return orderId;
      });
      this.emit(); return id;
    });
  }
  private async ownedOrder(id: string) {
    const state = await this.state();
    const order = await this.db.first<Order>('SELECT * FROM orders WHERE id=? AND shop_id=?', [id, state.active_shop_id]);
    if (!order) throw new DomainError('missing', '找不到此訂單，未變更任何資料。');
    return order;
  }
  async getOrder(id: string): Promise<OrderDetail> {
    return this.enqueue(async () => {
      const order = await this.ownedOrder(id);
      const payment = await this.db.first<{ payload: string }>('SELECT payload FROM order_payment_snapshots WHERE order_id=? AND shop_id=?', [id, order.shop_id]);
      return { order, payment: payment ? JSON.parse(payment.payload) as PaymentSnapshot : null, items: await this.db.all<OrderItem>('SELECT * FROM order_items WHERE order_id=? AND shop_id=? ORDER BY position', [id, order.shop_id]),
        history: await this.db.all<History>('SELECT * FROM status_history WHERE order_id=? AND shop_id=? ORDER BY recorded_at,rowid', [id, order.shop_id]) };
    });
  }
  async updateOrder(id: string, revision: number, input: OrderInput) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const old = await this.ownedOrder(id);
        if (old.revision !== revision) throw new DomainError('conflict', '訂單已更新，請返回詳情重新開啟。');
        if (!editable(old)) throw new DomainError('locked', '此訂單金額及對外資料已鎖定，不能覆寫。');
        const v = evaluate(input);
        await this.db.run(`UPDATE orders SET buyer_identifier=?,shipping_method=?,subtotal_cents=?,discount_cents=?,shipping_cents=?,total_cents=?,note=?,updated_at=?,revision=revision+1 WHERE id=?`,
          [v.buyer, v.shippingMethod, v.subtotal, v.discount, v.shipping, v.total, v.note, this.now(), id]);
        await this.db.run('DELETE FROM order_items WHERE order_id=?', [id]);
        await this.insertItems(id, old.shop_id, v);
        await this.saveOrderPayment(id, old.shop_id, input.payment);
      });
      this.emit();
    });
  }
  async changeStatus(id: string, revision: number, action: Action, reason: string) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const order = await this.ownedOrder(id);
        if (order.revision !== revision) throw new DomainError('conflict', '訂單已更新，請重新核對狀態。');
        const event = transition(order, action, reason, this.now()); const n = event.next;
        await this.db.run(`UPDATE orders SET order_status=?,payment_status=?,fulfillment_status=?,financial_locked_at=?,paid_at=?,refunded_at=?,refunded_amount_cents=?,fulfilled_at=?,cancelled_at=?,updated_at=?,revision=? WHERE id=?`,
          [n.order_status, n.payment_status, n.fulfillment_status, n.financial_locked_at, n.paid_at, n.refunded_at, n.refunded_amount_cents, n.fulfilled_at, n.cancelled_at, n.updated_at, n.revision, id]);
        await this.db.run('INSERT INTO status_history(id,order_id,shop_id,axis,from_value,to_value,reason,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
          [this.newId(), id, order.shop_id, event.axis, event.from, event.to, reason.trim(), n.updated_at]);
      });
      this.emit();
    });
  }
}
