import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderStore } from '../src/data/store.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { blankInput, toInput } from '../src/domain/model.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { buildNotice, noticeTextBlocks, noticeSourceKey, noticeMoney, noticeDate } from '../src/domain/notice.ts';
import { captureReleasePath, noticeCapturePlan, readNoticePngHeader, hasPngEnd } from '../src/domain/noticePng.ts';

const date = '2026-01-01T16:05:00.000Z';
const fps = () => ({ ...emptyPayment(), fpsType: 'email', fpsValue: 'synthetic@example.invalid', confirmed: true });
const bank = () => ({ ...emptyPayment(), bankName: '合成銀行', accountName: 'SYNTHETIC ONLY', accountNumber: 'NOT-A-REAL-ACCOUNT', confirmed: true });
function adapter(db) { return { exec: async (s) => { db.exec(s); }, run: async (s, p = []) => db.prepare(s).run(...p), first: async (s, p = []) => db.prepare(s).get(...p) ?? null, all: async (s, p = []) => db.prepare(s).all(...p) }; }
async function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); let n = 0; const health = new Map();
  const store = new OrderStore(adapter(db), () => `synthetic-${++n}`, () => date, async (asset) => health.get(asset.id) ?? 'available');
  await store.initialize(); return { db, store, health };
}
async function configure(store, kind = 'fps', input = fps()) {
  await store.savePaymentMethod(kind, input); return (await store.getPaymentSettings()).methods.find((m) => m.kind === kind);
}
async function blocked(store, id) { const context = await store.getNoticeContext(id); assert.throws(() => buildNotice(context)); }
async function order(store, count = 3, payment = undefined, extra = {}) {
  const draft = await store.openDraft();
  const input = { ...blankInput('synthetic-item'), buyer: '@synthetic_only', items: Array.from({ length: count }, (_, n) => ({ id: `synthetic-item-${n}`, name: `商品 ${String(n + 1).padStart(2, '0')} · Item`, price: '39.00', quantity: '1' })), ...extra, payment };
  return store.createOrder(draft.requestId, input);
}
function record(document, suffix = '1') {
  const id = `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  return { id, orderId: document.orderId, shopId: document.shopId, orderRevision: document.orderRevision, preferencesRevision: document.preferencesRevision,
    template: document.template, relativePath: `payment-notices/${id}.png`, width: 1080, height: 2400, bytes: 10000, sha256: 'a'.repeat(64),
    dataHash: createHash('sha256').update(noticeSourceKey(document)).digest('hex'), createdAt: date };
}

test('both Free templates retain all 1/3/20 items, integer-cent snapshots, mixed text and explicit customer-note boundary', async () => {
  for (const count of [1, 3, 20]) {
    const { db, store } = await fixture();
    try {
      await store.saveShop('合成店舖 · Synthetic', '合成品牌資料'); const payment = await configure(store);
      const name = '繁體商品LongItem'.repeat(12).slice(0, 120), note = '僅測試客戶備註'.repeat(80).slice(0, 500);
      const items = Array.from({ length: count }, (_, n) => ({ id: `item-${n}`, name: n === count - 1 ? name : `合成商品 ${n + 1}`, price: '39.00', quantity: '1' }));
      const id = await order(store, count, snapshotOf(payment), { items, note, shipping: 'custom', shippingFee: '20.00', discount: '1.50' });
      const before = await store.getOrder(id); const context = await store.getNoticeContext(id); assert.equal(buildNotice(context).customerNote, '');
      for (const template of ['editorial', 'soft']) {
        const current = await store.getNoticeContext(id); await store.saveNoticePreferences(id, 1, current.preferences.revision, { template, includeNote: true, confirmedNote: note });
        const document = buildNotice(await store.getNoticeContext(id)); const blocks = noticeTextBlocks(document);
        assert.equal(document.items.length, count); assert.equal(document.items[0].position, 0); assert.equal(document.items.at(-1).name, name);
        assert.equal(document.totalCents, count * 3900 - 150 + 2000); assert.equal(document.customerNote, note);
        assert.equal(blocks.total, noticeMoney(count * 3900 - 150 + 2000)); assert.equal(blocks[`item-${count - 1}-serial`], String(count).padStart(2, '0'));
        assert.equal(blocks[`item-${count - 1}-name`], name); assert.equal(blocks.note, note); assert.equal(blocks.brand, 'Made with OrderMori');
        assert.equal(blocks.title, '付款通知 / Payment Notice'); assert.match(blocks.legal, /並非正式收據/);
      }
      assert.deepEqual(await store.getOrder(id), before); assert.equal((await store.getHome()).createdCount, 1);
    } finally { db.close(); }
  }
});

test('shipping and discount use saved cents: SF collect is paid to carrier, not added to merchant total', async () => {
  const { db, store } = await fixture();
  try {
    await store.saveShop('合成店', ''); const method = await configure(store);
    for (const shipping of ['included', 'sf_collect', 'pickup', 'custom']) {
      const id = await order(store, 3, snapshotOf(method), { shipping, shippingFee: shipping === 'custom' ? '30' : '0', discount: '17' });
      const doc = buildNotice(await store.getNoticeContext(id)); assert.equal(doc.totalCents, shipping === 'custom' ? 13000 : 10000);
      if (shipping === 'sf_collect') { assert.equal(doc.shippingCents, 0); assert.match(doc.shippingText, /另付予順豐/); }
      const broken = await store.getNoticeContext(id); broken.detail.order.total_cents++;
      assert.throws(() => buildNotice(broken), (e) => e.code === 'notice');
    }
  } finally { db.close(); }
});

test('A/B/C payments adapt without empty QR fields; unconfirmed, missing, changed or foreign assets block output', async () => {
  const { db, store, health } = await fixture();
  try {
    await store.saveShop('合成店', ''); const shop = await store.getShop();
    for (const [n, kind, text] of [[1, 'fps', true], [2, 'fps', false], [3, 'payme', false]]) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
      const asset = { id, shopId: shop.id, kind, relativePath: `payment-assets/${id}.png`, mime: 'image/png', bytes: 68, sha256: 'b'.repeat(64), width: 320, height: 420 };
      await store.registerPaymentAsset(asset); const method = await configure(store, kind, { ...(text ? fps() : emptyPayment()), qrAssetId: id, confirmed: true });
      const orderId = await order(store, 1, snapshotOf(method)); const context = await store.getNoticeContext(orderId); const document = buildNotice(context);
      assert.equal(document.qr.id, id); assert.equal(!!noticeTextBlocks(document).paymentValue, text);
      health.set(id, 'missing'); assert.throws(() => buildNotice(awaitContextClone(context, 'missing'))); assert.throws(() => buildNotice(awaitContextClone(context, 'invalid')));
      assert.throws(() => buildNotice({ ...context, payment: { ...context.payment, asset: { ...asset, shopId: 'foreign' } } }));
      await blocked(store, orderId);
      health.delete(id);
    }
    for (const [kind, input] of [['fps', fps()], ['bank', bank()]]) {
      const method = await configure(store, kind, input), id = await order(store, 1, snapshotOf(method));
      const context = await store.getNoticeContext(id), doc = buildNotice(context); assert.equal(doc.qr, null); assert.equal(noticeTextBlocks(doc).qrLabel, undefined);
      context.payment.snapshot.confirmed = false; assert.throws(() => buildNotice(context));
    }
  } finally { db.close(); }
});
function awaitContextClone(context, state) { return { ...context, payment: { ...context.payment, qrState: state } }; }

test('missing legacy snapshots require explicit selection; current shop/payment changes never backfill historical output', async () => {
  const { db, store } = await fixture();
  try {
    await store.saveShop('原店名', '原簡介'); const old = await order(store, 1, null);
    await blocked(store, old);
    const method = await configure(store); let detail = await store.getOrder(old);
    await store.updateOrder(old, detail.order.revision, { ...toInput(detail), payment: snapshotOf(method) });
    const original = buildNotice(await store.getNoticeContext(old));
    await store.saveShop('新的店名', '新的簡介'); await configure(store, 'fps', { ...fps(), fpsValue: 'other-synthetic@example.invalid' });
    assert.equal(noticeSourceKey(buildNotice(await store.getNoticeContext(old))), noticeSourceKey(original));
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('paid/refunded/cancelled/fulfilled orders cannot create new request files; correction never unlocks notice settings', async () => {
  const { db, store } = await fixture();
  try {
    await store.saveShop('合成店', ''); const method = await configure(store); const id = await order(store, 1, snapshotOf(method));
    const original = buildNotice(await store.getNoticeContext(id)), file = record(original); await store.recordNoticeFile(file, noticeSourceKey(original));
    await store.changeStatus(id, 1, 'mark_paid', '合成人工登記'); await blocked(store, id);
    await assert.rejects(store.recordNoticeFile(record(original, '2'), noticeSourceKey(original)));
    await store.changeStatus(id, 2, 'correct_payment', '合成誤標糾正'); assert.ok(buildNotice(await store.getNoticeContext(id)));
    await assert.rejects(store.saveNoticePreferences(id, 3, 0, { template: 'soft', includeNote: false }));
    await store.changeStatus(id, 3, 'cancel', '合成取消'); await blocked(store, id);
    const other = await order(store, 1, snapshotOf(method)); await store.changeStatus(other, 1, 'mark_paid', '合成付款'); await store.changeStatus(other, 2, 'fulfill', '合成履約');
    await blocked(store, other); await store.changeStatus(other, 3, 'refund', '合成退款'); await blocked(store, other);
    assert.equal((await store.listNoticeFiles(id)).length, 1); await store.removeNoticeFile(id, file.id);
    assert.equal((await store.listNoticeFiles(id)).length, 0); assert.equal((await store.getHome()).createdCount, 2);
  } finally { db.close(); }
});

test('output finalization rejects stale order/settings, cancellation and wrong ownership; old file records stay immutable', async () => {
  const { db, store } = await fixture();
  try {
    await store.saveShop('合成店', ''); const method = await configure(store); const id = await order(store, 1, snapshotOf(method));
    const document = buildNotice(await store.getNoticeContext(id)); const file = record(document);
    await assert.rejects(store.recordNoticeFile(file, noticeSourceKey(document), () => false));
    await assert.rejects(store.recordNoticeFile({ ...file, shopId: 'foreign' }, noticeSourceKey(document)));
    await store.recordNoticeFile(file, noticeSourceKey(document));
    assert.throws(() => db.prepare('UPDATE notice_files SET relative_path=? WHERE id=?').run('other.png', file.id));
    await store.saveNoticePreferences(id, 1, 0, { template: 'soft', includeNote: false });
    await assert.rejects(store.recordNoticeFile(record(document, '2'), noticeSourceKey(document)));
    const next = buildNotice(await store.getNoticeContext(id)); assert.notEqual(noticeSourceKey(next), noticeSourceKey(document));
    const detail = await store.getOrder(id); await store.updateOrder(id, 1, { ...toInput(detail), note: '已改變' });
    await assert.rejects(store.recordNoticeFile(record(next, '3'), noticeSourceKey(next)));
    assert.deepEqual((await store.listNoticeFiles(id))[0], {...file,locale:'zh-HK'}); assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('customer note defaults private; explicit consent freezes text and later edits require new consent', async () => {
  const { db, store } = await fixture();
  try {
    await store.saveShop('合成店', ''); const method = await configure(store); const id = await order(store, 1, snapshotOf(method), { note: '合成內部備註' });
    assert.equal(noticeTextBlocks(buildNotice(await store.getNoticeContext(id))).note, undefined);
    await assert.rejects(store.saveNoticePreferences(id, 1, 0, { template: 'editorial', includeNote: true }));
    await store.saveNoticePreferences(id, 1, 0, { template: 'editorial', includeNote: true, confirmedNote: '合成內部備註' });
    assert.equal(buildNotice(await store.getNoticeContext(id)).customerNote, '合成內部備註');
    const detail = await store.getOrder(id); await store.updateOrder(id, 1, { ...toInput(detail), note: '新的未確認備註' });
    await blocked(store, id);
    await store.saveNoticePreferences(id, 2, 1, { template: 'soft', includeNote: true });
    await blocked(store, id); assert.equal((await store.getNoticeContext(id)).preferences.noteSnapshot, '合成內部備註');
    await assert.rejects(store.saveNoticePreferences(id, 2, 2, { template: 'soft', includeNote: true, confirmedNote: '錯誤版本' }));
    await store.saveNoticePreferences(id, 2, 2, { template: 'soft', includeNote: true, confirmedNote: '新的未確認備註' });
    assert.equal(buildNotice(await store.getNoticeContext(id)).customerNote, '新的未確認備註');
    await store.saveNoticePreferences(id, 2, 3, { template: 'editorial', includeNote: false });
    assert.equal(buildNotice(await store.getNoticeContext(id)).customerNote, '');
  } finally { db.close(); }
});

test('empty shop snapshot is filled only by explicit operation, never replaces an existing shop snapshot', async () => {
  const { db, store } = await fixture();
  try {
    const method = await configure(store), id = await order(store, 1, snapshotOf(method));
    await blocked(store, id); await store.saveShop('明確確認的新店名', '簡介');
    assert.equal((await store.getOrder(id)).order.shop_name_snapshot, '');
    await assert.rejects(store.completeNoticeShopSnapshot(id, 1, { name: '未確認的另一個名稱', description: '' }));
    await store.completeNoticeShopSnapshot(id, 1, await store.getShop());
    assert.equal(buildNotice(await store.getNoticeContext(id)).shopName, '明確確認的新店名');
    await assert.rejects(store.completeNoticeShopSnapshot(id, 2, await store.getShop())); assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('real v2 SQLite data migrates forward and persists preferences/files across reopen without rewriting rows or quota', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ordermori-notice-migrate-')); let current;
  try {
    const path = join(folder, 'test.sqlite'); const db = new DatabaseSync(path); db.exec(MIGRATIONS[0].sql); db.exec(MIGRATIONS[1].sql); db.exec('PRAGMA user_version=2');
    db.exec("INSERT INTO shops VALUES('old-shop','舊店名','舊簡介','2026-01-01'); INSERT INTO app_state(id,profile_id,active_shop_id,created_count,order_number_seq) VALUES(1,'old-profile','old-shop',1,1)");
    db.prepare(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
      VALUES('old-order','old-shop','OM-000001','old-request','@synthetic','舊店名','舊簡介','active','unpaid','pending','sf_collect',3900,0,0,3900,'舊備註',?,?)`).run(date, date);
    db.exec("INSERT INTO order_items VALUES('old-item','old-order','old-shop',0,'舊商品',1,3900,3900)");
    const snapshot = { ...fps(), version: 1, methodId: 'old-method', shopId: 'old-shop', kind: 'fps', revision: 1, confirmedAt: date };
    db.prepare('INSERT INTO payment_methods VALUES(?,?,?,?,NULL,1,?)').run('old-method','old-shop','fps',JSON.stringify(snapshot),date);
    db.prepare('INSERT INTO order_payment_snapshots VALUES(?,?,?,?,NULL)').run('old-order','old-shop','fps',JSON.stringify(snapshot));
    const oldRows = Object.fromEntries(['orders','order_items','payment_methods','order_payment_snapshots','app_state'].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
    db.close(); current = await fixture(path);
    assert.equal(current.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    for (const [table, rows] of Object.entries(oldRows)) assert.deepEqual(current.db.prepare(`SELECT * FROM ${table}`).all(), rows);
    await current.store.saveNoticePreferences('old-order', 1, 0, { template: 'soft', includeNote: false });
    const document = buildNotice(await current.store.getNoticeContext('old-order')); await current.store.recordNoticeFile(record(document), noticeSourceKey(document));
    current.db.close(); current = await fixture(path); assert.equal((await current.store.getNoticeContext('old-order')).preferences.template, 'soft'); assert.equal((await current.store.listNoticeFiles('old-order')).length, 1);
    for (const [table, rows] of Object.entries(oldRows)) assert.deepEqual(current.db.prepare(`SELECT * FROM ${table}`).all(), rows);
  } finally { current?.db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('v3 migration failure rolls back without changing schema version or v2 payment tables', async () => {
  const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS[0].sql); db.exec(MIGRATIONS[1].sql); db.exec('PRAGMA user_version=2');
  try {
    const port = adapter(db), exec = port.exec; port.exec = async (sql) => { if (sql.includes('CREATE TABLE notice_preferences')) { db.exec('CREATE TABLE injected_partial(id TEXT)'); throw Error('synthetic failure'); } return exec(sql); };
    const store = new OrderStore(port, () => 'unused'); await assert.rejects(store.initialize());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2); assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='injected_partial'").get().n, 0);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='payment_methods'").get());
  } finally { db.close(); }
});

test('physical pixel plans distinguish RN points and pixels, validate headers and reject unsafe sizes without truncation', () => {
  for (const ratio of [1, 2, 3, 3.5]) {
    const plan = noticeCapturePlan({ width: 360, height: 1200 }, ratio); assert.equal(Math.round(plan.width * ratio), 1080); assert.equal(Math.round(plan.height * ratio), 3600);
  }
  assert.throws(() => noticeCapturePlan({ width: 360, height: 100000 }, 3)); assert.throws(() => noticeCapturePlan({ width: 0, height: 2 }, 3));
  const header = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,4,56,0,0,9,96]);
  assert.deepEqual(readNoticePngHeader(header), { width: 1080, height: 2400 }); assert.throws(() => readNoticePngHeader(header.slice(0,20)));
  assert.ok(hasPngEnd(new Uint8Array([0,0,0,0,73,69,78,68,174,66,96,130]))); assert.equal(hasPngEnd(new Uint8Array(12)), false);
  assert.equal(noticeMoney(11700), 'HK$ 117.00'); assert.equal(noticeDate(date), '2026/01/02 00:05 HKT');
  assert.equal(captureReleasePath('file:///tmp/ReactNative/a%20b.png'), '/tmp/ReactNative/a b.png'); assert.equal(captureReleasePath('/tmp/ReactNative/c.png'), '/tmp/ReactNative/c.png');
});
