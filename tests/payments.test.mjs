import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { constants, mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { OrderStore } from '../src/data/store.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { blankInput, toInput } from '../src/domain/model.ts';
import { emptyPayment, normalizePayment, paymentStatus, snapshotOf } from '../src/domain/payment.ts';
import { hasDraftInput } from '../src/ui/home.ts';
import { copyOfficialQr } from '../src/data/qrCopy.ts';

const now = '2026-01-01T00:00:00.000Z';
const orderInput = () => ({ ...blankInput('synthetic-item'), buyer: '@synthetic_buyer', items: [{ id: 'synthetic-item', name: '合成測試商品', price: '39', quantity: '3' }] });
const fps = () => ({ ...emptyPayment(), fpsType: 'email', fpsValue: 'synthetic@example.invalid', confirmed: true });
const bank = () => ({ ...emptyPayment(), bankName: '合成測試銀行（非真實）', accountName: 'SYNTHETIC TEST', accountNumber: 'TEST-ONLY-NOT-AN-ACCOUNT', confirmed: true });
function port(db) {
  return { exec: async (sql) => { db.exec(sql); }, run: async (sql, params = []) => db.prepare(sql).run(...params),
    first: async (sql, params = []) => db.prepare(sql).get(...params) ?? null, all: async (sql, params = []) => db.prepare(sql).all(...params) };
}
let instance = 0;
async function setup(path = ':memory:', db = new DatabaseSync(path)) {
  let id = 0; const prefix = ++instance; const health = new Map();
  const verify = async (asset) => health.get(asset.id) ?? 'available';
  const store = new OrderStore(port(db), () => `synthetic-${prefix}-${++id}`, () => now, verify);
  await store.initialize(); return { store, db, health };
}
function asset(shopId, suffix = '1', kind = 'fps') {
  const id = `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
  return { id, shopId, kind, relativePath: `payment-assets/${id}.png`, mime: 'image/png', bytes: 68, sha256: 'a'.repeat(64), width: 1, height: 1 };
}
async function method(store, kind = 'fps', input = fps()) {
  await store.savePaymentMethod(kind, input);
  return (await store.getPaymentSettings()).methods.find((entry) => entry.kind === kind);
}
async function create(store, payment = undefined) {
  const draft = await store.openDraft(); const input = { ...orderInput(), payment };
  const id = await store.createOrder(draft.requestId, input); return { id, input, requestId: draft.requestId };
}

test('completeness is distinct from saving; PayMe cannot use arbitrary identifiers, missing QR never falls back silently', () => {
  assert.equal(paymentStatus('fps', emptyPayment(), 'none'), 'not_configured');
  assert.equal(paymentStatus('fps', { ...fps(), confirmed: false }, 'none'), 'incomplete');
  assert.equal(paymentStatus('fps', fps(), 'none'), 'ready');
  assert.equal(paymentStatus('fps', { ...fps(), fpsValue: 'invalid' }, 'none'), 'incomplete');
  for (const value of ['0000000', '000000000']) assert.equal(paymentStatus('fps', { ...fps(), fpsType: 'id', fpsValue: value }, 'none'), 'ready');
  for (const value of ['1', '00000000', 'ABCDEFGHI']) assert.equal(paymentStatus('fps', { ...fps(), fpsType: 'id', fpsValue: value }, 'none'), 'incomplete');
  assert.equal(paymentStatus('fps', { ...fps(), fpsType: 'phone', fpsValue: '00000000' }, 'none'), 'ready');
  assert.equal(paymentStatus('fps', { ...fps(), qrAssetId: 'synthetic-qr' }, 'missing'), 'incomplete');
  assert.equal(paymentStatus('fps', { ...fps(), qrAssetId: null }, 'none'), 'ready');
  assert.equal(paymentStatus('payme', normalizePayment('payme', fps()), 'none'), 'not_configured');
  assert.equal(paymentStatus('payme', { ...emptyPayment(), qrAssetId: 'synthetic-qr', confirmed: false }, 'available'), 'incomplete');
  assert.equal(paymentStatus('payme', { ...emptyPayment(), qrAssetId: 'synthetic-qr', confirmed: true }, 'available'), 'ready');
  for (const key of ['bankName', 'accountName', 'accountNumber']) assert.equal(paymentStatus('bank', { ...bank(), [key]: '' }, 'none'), 'incomplete');
  assert.equal(paymentStatus('bank', { ...bank(), confirmed: false }, 'none'), 'incomplete');
  assert.equal(paymentStatus('bank', bank(), 'none'), 'ready');
  assert.throws(() => normalizePayment('bank', { ...bank(), qrAssetId: 'unexpected' }));
});

test('incomplete settings persist; default must be ready and remains a single local choice', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ordermori-payment-')); let current;
  try {
    const path = join(directory, 'test.sqlite'); current = await setup(path);
    const incomplete = await method(current.store, 'bank', { ...bank(), accountName: '' });
    assert.equal(incomplete.status, 'incomplete');
    await assert.rejects(current.store.setDefaultPaymentMethod(incomplete.methodId));
    const ready = await method(current.store);
    await current.store.setDefaultPaymentMethod(ready.methodId);
    await assert.rejects(current.store.savePaymentMethod('fps', fps(), null), (error) => error.code === 'conflict');
    current.db.close(); current = await setup(path);
    const settings = await current.store.getPaymentSettings();
    assert.equal(settings.defaultMethodId, ready.methodId); assert.equal(settings.methods.length, 2);
    assert.equal(settings.methods.find((entry) => entry.kind === 'bank').status, 'incomplete');
    const next = await method(current.store, 'bank', bank());
    await current.store.setDefaultPaymentMethod(next.methodId);
    assert.equal(current.db.prepare('SELECT count(*) AS n FROM shop_payment_defaults').get().n, 1);
    assert.equal((await current.store.getHome()).createdCount, 0);
  } finally { current?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('unconfirmed FPS, PayMe and bank settings persist as incomplete and cannot replace a ready default', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ordermori-unconfirmed-')); let current;
  try {
    const path = join(directory, 'test.sqlite'); current = await setup(path);
    const shop = await current.store.getShop(); const qr = asset(shop.id, '4', 'payme');
    await current.store.registerPaymentAsset(qr);
    for (const [kind, input] of [
      ['fps', { ...fps(), confirmed: false }],
      ['payme', { ...emptyPayment(), qrAssetId: qr.id, confirmed: false }],
      ['bank', { ...bank(), confirmed: false }],
    ]) {
      const saved = await method(current.store, kind, input);
      assert.equal(saved.status, 'incomplete'); assert.equal(saved.confirmedAt, null);
      await assert.rejects(current.store.setDefaultPaymentMethod(saved.methodId), (error) => error.code === 'payment');
    }
    current.db.close(); current = await setup(path);
    const settings = await current.store.getPaymentSettings();
    assert.equal(settings.defaultMethodId, null); assert.equal(settings.methods.length, 3);
    for (const saved of settings.methods) { assert.equal(saved.status, 'incomplete'); assert.equal(saved.confirmed, false); assert.equal(saved.confirmedAt, null); }
    const ready = await method(current.store, 'bank', bank());
    await current.store.setDefaultPaymentMethod(ready.methodId);
    for (const incomplete of settings.methods.filter((entry) => entry.kind !== 'bank')) {
      await assert.rejects(current.store.setDefaultPaymentMethod(incomplete.methodId), (error) => error.code === 'payment');
      assert.equal((await current.store.getPaymentSettings()).defaultMethodId, ready.methodId);
    }
    const payme = await method(current.store, 'payme', { ...emptyPayment(), qrAssetId: qr.id, confirmed: true });
    assert.equal(payme.status, 'ready'); await current.store.setDefaultPaymentMethod(payme.methodId);
    current.db.close(); current = await setup(path);
    assert.equal((await current.store.getPaymentSettings()).defaultMethodId, payme.methodId);
    assert.equal((await current.store.getHome()).createdCount, 0);
  } finally { current?.db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('incomplete or missing-image defaults pause only for new drafts, preserving existing drafts and historical snapshots', async () => {
  const { store, db, health } = await setup();
  try {
    const shop = await store.getShop(); const qr = asset(shop.id, '5'); await store.registerPaymentAsset(qr);
    const original = await method(store, 'fps', { ...fps(), qrAssetId: qr.id }); await store.setDefaultPaymentMethod(original.methodId);
    const saved = await create(store, snapshotOf(original)); const historical = await store.getOrder(saved.id);
    const existing = await store.openDraft();
    await store.saveDraft(existing.requestId, 1, { ...existing.input, note: '保留合成測試草稿' });
    const changedInput = { ...fps(), fpsValue: 'updated-synthetic@example.invalid', qrAssetId: qr.id, confirmed: false };
    const incomplete = await method(store, 'fps', changedInput);
    assert.equal(incomplete.status, 'incomplete');
    await assert.rejects(store.setDefaultPaymentMethod(incomplete.methodId));
    assert.equal((await store.getPaymentSettings()).defaultMethodId, original.methodId);
    assert.deepEqual((await store.openDraft()).input.payment, snapshotOf(original));
    assert.equal((await store.openDraft()).input.note, '保留合成測試草稿');
    await store.discardDraft(existing.requestId);
    const paused = await store.openDraft(); assert.equal(paused.input.payment, null);
    assert.equal((await store.getDraftInput()).payment, null);
    const reconfirmed = await method(store, 'fps', { ...changedInput, confirmed: true });
    assert.equal(reconfirmed.status, 'ready');
    assert.equal((await store.openDraft()).input.payment, null, 'reconfirmation must not backfill an already opened draft');
    await store.discardDraft(paused.requestId);
    const resumed = await store.openDraft(); assert.deepEqual(resumed.input.payment, snapshotOf(reconfirmed));
    health.set(qr.id, 'missing');
    assert.deepEqual((await store.openDraft()).input.payment, snapshotOf(reconfirmed));
    await store.discardDraft(resumed.requestId);
    assert.equal((await store.openDraft()).input.payment, null);
    await assert.rejects(store.setDefaultPaymentMethod(original.methodId));
    assert.deepEqual(await store.getOrder(saved.id), historical);
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('new draft captures default once; changing settings never rewrites its choice or order snapshot', async () => {
  const { store, db } = await setup();
  try {
    const first = await method(store); await store.setDefaultPaymentMethod(first.methodId);
    const draft = await store.openDraft();
    assert.deepEqual(draft.input.payment, snapshotOf(first)); assert.equal(hasDraftInput(draft.input), false);
    await method(store, 'fps', { ...fps(), fpsValue: 'other-synthetic@example.invalid' });
    const changedDefault = await method(store, 'bank', bank()); await store.setDefaultPaymentMethod(changedDefault.methodId);
    assert.deepEqual((await store.openDraft()).input.payment, snapshotOf(first));
    const input = { ...orderInput(), payment: draft.input.payment, paymentChosen: true };
    await store.saveDraft(draft.requestId, 1, input);
    assert.equal(hasDraftInput({ ...blankInput('new'), paymentChosen: true }), true);
    const id = await store.createOrder(draft.requestId, input);
    assert.equal((await store.getOrder(id)).payment.fpsValue, first.fpsValue);
    assert.equal((await store.getOrder(id)).order.total_cents, 11700);
    const next = await store.openDraft(); assert.equal(next.input.payment.kind, 'bank');
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('QR replacement and removal preserve old asset and historical snapshot; missing old file is explicit', async () => {
  const { store, db, health } = await setup();
  try {
    const shop = await store.getShop(); const original = asset(shop.id); await store.registerPaymentAsset(original);
    const oldMethod = await method(store, 'fps', { ...fps(), qrAssetId: original.id });
    const saved = await create(store, snapshotOf(oldMethod));
    const replacement = asset(shop.id, '2'); await store.registerPaymentAsset(replacement);
    await method(store, 'fps', { ...fps(), qrAssetId: replacement.id });
    const historical = (await store.getOrder(saved.id)).payment;
    assert.equal(historical.qrAssetId, original.id);
    assert.equal((await store.inspectPayment(historical)).asset.relativePath, original.relativePath);
    health.set(original.id, 'missing');
    assert.equal((await store.inspectPayment(historical)).status, 'incomplete');
    assert.equal((await store.getPaymentSettings()).methods[0].status, 'ready');
    await method(store, 'fps', fps());
    assert.equal((await store.getOrder(saved.id)).payment.qrAssetId, original.id);
    assert.equal(db.prepare('SELECT count(*) AS n FROM payment_assets').get().n, 2);
    assert.throws(() => db.prepare('DELETE FROM payment_assets WHERE id=?').run(original.id));
    assert.throws(() => db.prepare('UPDATE payment_assets SET sha256=? WHERE id=?').run('b'.repeat(64), original.id));
  } finally { db.close(); }
});

test('payment snapshots obey permanent financial lock, including correction and direct SQLite mutation', async () => {
  const { store, db } = await setup();
  try {
    const selected = await method(store); const saved = await create(store, snapshotOf(selected));
    let detail = await store.getOrder(saved.id);
    await store.changeStatus(saved.id, detail.order.revision, 'mark_paid', '合成測試人工登記');
    detail = await store.getOrder(saved.id);
    await store.changeStatus(saved.id, detail.order.revision, 'correct_payment', '合成誤標測試');
    detail = await store.getOrder(saved.id);
    await assert.rejects(store.updateOrder(saved.id, detail.order.revision, { ...toInput(detail), payment: null }));
    assert.throws(() => db.prepare('DELETE FROM order_payment_snapshots WHERE order_id=?').run(saved.id));
    assert.throws(() => db.prepare('UPDATE order_payment_snapshots SET payload=? WHERE order_id=?').run('{}', saved.id));
    await method(store, 'fps', { ...fps(), fpsValue: 'different@example.invalid' });
    assert.equal((await store.getOrder(saved.id)).payment.fpsValue, selected.fpsValue);
    const noSnapshot = await create(store, null);
    await store.changeStatus(noSnapshot.id, 1, 'mark_paid', '合成舊單鎖定測試');
    assert.throws(() => db.prepare('INSERT INTO order_payment_snapshots(order_id,shop_id,kind,payload,qr_asset_id) VALUES(?,?,?,?,NULL)')
      .run(noSnapshot.id, selected.shopId, 'fps', JSON.stringify(snapshotOf(selected))));
  } finally { db.close(); }
});

test('snapshot failure rolls back entire creation; repeated request cannot replace the first snapshot or charge twice', async () => {
  const { store, db } = await setup();
  try {
    const selected = await method(store); const draft = await store.openDraft(); const input = { ...orderInput(), payment: snapshotOf(selected) };
    db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON order_payment_snapshots BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    await assert.rejects(store.createOrder(draft.requestId, input));
    for (const table of ['orders', 'order_items', 'creation_ledger', 'status_history', 'order_payment_snapshots']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    assert.equal((await store.getHome()).createdCount, 0);
    db.exec('DROP TRIGGER fail_payment'); const id = await store.createOrder(draft.requestId, input);
    assert.equal(await store.createOrder(draft.requestId, { ...input, payment: null }), id);
    assert.deepEqual((await store.getOrder(id)).payment, snapshotOf(selected));
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('unpaid explicit selection changes work; legacy undefined input preserves snapshot; no payment remains valid', async () => {
  const { store, db } = await setup();
  try {
    const selected = await method(store); const saved = await create(store, snapshotOf(selected));
    await store.updateOrder(saved.id, 1, orderInput());
    assert.equal((await store.getOrder(saved.id)).payment.methodId, selected.methodId);
    await store.updateOrder(saved.id, 2, { ...orderInput(), payment: null });
    assert.equal((await store.getOrder(saved.id)).payment, null);
    assert.equal((await store.getHome()).createdCount, 1);
    await store.updateOrder(saved.id, 3, { ...orderInput(), payment: snapshotOf(selected) });
    assert.equal((await store.getOrder(saved.id)).payment.kind, 'fps');
    const noPayment = await create(store, null); assert.equal((await store.getOrder(noPayment.id)).payment, null);
  } finally { db.close(); }
});

test('asset ownership, method kind and single snapshot boundaries reject cross-shop or malformed references', async () => {
  const { store, db } = await setup();
  try {
    const shop = await store.getShop();
    await assert.rejects(store.registerPaymentAsset(asset('other-shop')));
    const payme = asset(shop.id, '3', 'payme'); await store.registerPaymentAsset(payme);
    await assert.rejects(store.savePaymentMethod('fps', { ...fps(), qrAssetId: payme.id }));
    const selected = await method(store); const draft = await store.openDraft();
    await assert.rejects(store.inspectPayment({ ...snapshotOf(selected), version: 2 }));
    await assert.rejects(store.createOrder(draft.requestId, { ...orderInput(), payment: { ...snapshotOf(selected), shopId: 'other-shop' } }));
    await assert.rejects(store.createOrder(draft.requestId, { ...orderInput(), payment: [snapshotOf(selected)] }));
    assert.equal((await store.getHome()).createdCount, 0);
  } finally { db.close(); }
});

test('v1 database migration preserves real rows, counter, legacy draft and no-payment historical orders across reopen', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ordermori-v1-upgrade-')); let db; let current;
  try {
    const path = join(folder, 'legacy.sqlite'); db = new DatabaseSync(path); db.exec(MIGRATIONS[0].sql); db.exec('PRAGMA user_version=1');
    db.prepare('INSERT INTO shops(id,name,description,updated_at) VALUES(?,?,?,?)').run('legacy-shop', '合成舊店舖', '保留資料', now);
    db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id,created_count,order_number_seq) VALUES(1,?,?,1,1)').run('legacy-profile', 'legacy-shop');
    db.prepare(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
      VALUES('legacy-order','legacy-shop','OM-000001','legacy-request','@synthetic_legacy','合成舊店舖','','active','unpaid','pending','included',11700,0,0,11700,'保留備註',?,?)`).run(now, now);
    db.prepare('INSERT INTO drafts(id,shop_id,request_id,payload,is_active,updated_at) VALUES(1,?,?,?,1,?)').run('legacy-shop', 'legacy-draft', JSON.stringify({ version: 1, input: { ...blankInput('legacy-item'), note: '保留草稿' } }), now);
    const original = db.prepare('SELECT * FROM orders').get();
    current = await setup(path, db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.deepEqual(db.prepare('SELECT * FROM orders').get(), original);
    assert.equal((await current.store.openDraft()).input.note, '保留草稿');
    assert.equal((await current.store.openDraft()).input.payment, undefined);
    assert.equal((await current.store.getHome()).createdCount, 1);
    assert.equal((await current.store.getOrder('legacy-order')).payment, null);
    await method(current.store); db.close(); current = await setup(path); db = current.db;
    assert.deepEqual(db.prepare('SELECT * FROM orders').get(), original);
    assert.equal((await current.store.getPaymentSettings()).methods.length, 1);
    assert.equal((await current.store.getHome()).createdCount, 1);
  } finally { db?.close(); rmSync(folder, { recursive: true, force: true }); }
});

test('failing a forward migration leaves v1 data and schema version intact', async () => {
  const db = new DatabaseSync(':memory:'); db.exec(MIGRATIONS[0].sql); db.exec('PRAGMA user_version=1');
  const adapter = port(db); const normal = adapter.exec; adapter.exec = async (sql) => { if (sql.includes('CREATE TABLE payment_assets')) throw Error('synthetic migration failure'); return normal(sql); };
  try {
    const store = new OrderStore(adapter, () => 'unused-id'); await assert.rejects(store.initialize());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='payment_assets'").get().n, 0);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='orders'").get());
  } finally { db.close(); }
});

test('QR copy preserves selected bytes and hash; failed or corrupt copy cleans only its new destination', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ordermori-qr-copy-'));
  try {
    // A synthetic 1px PNG, never a payment QR or real account image.
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
    const source = join(folder, 'synthetic.png'); const old = join(folder, 'old.png'); writeFileSync(source, bytes); writeFileSync(old, bytes);
    const paths = new Map(); const inspect = async (uri) => { const data = readFileSync(fileURLToPath(uri)); return { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), mime: 'image/png', width: 1, height: 1 }; };
    const io = { inspect, copy: async (uri, relative) => { const target = join(folder, relative.split('/').at(-1)); paths.set(relative, target); copyFileSync(fileURLToPath(uri), target, constants.COPYFILE_EXCL); return pathToFileURL(target).href; },
      removeNewFile: async (relative) => { const target = paths.get(relative); if (target && existsSync(target)) unlinkSync(target); } };
    const imported = await copyOfficialQr(pathToFileURL(source).href, 'synthetic-shop', 'fps', asset('synthetic-shop').id, io);
    assert.deepEqual(readFileSync(paths.get(imported.relativePath)), bytes);
    await assert.rejects(copyOfficialQr(pathToFileURL(source).href, 'synthetic-shop', 'fps', imported.id, io));
    assert.deepEqual(readFileSync(paths.get(imported.relativePath)), bytes);
    const corrupt = { ...io, copy: async (uri, relative) => { const targetUri = await io.copy(uri, relative); writeFileSync(fileURLToPath(targetUri), 'synthetic corruption'); return targetUri; } };
    await assert.rejects(copyOfficialQr(pathToFileURL(source).href, 'synthetic-shop', 'fps', asset('synthetic-shop', '9').id, corrupt));
    assert.equal(existsSync(paths.get(asset('synthetic-shop', '9').relativePath)), false);
    const broken = { ...io, copy: async () => { throw Error('synthetic disk full'); } };
    await assert.rejects(copyOfficialQr(pathToFileURL(source).href, 'synthetic-shop', 'fps', asset('synthetic-shop', '8').id, broken));
    await assert.rejects(copyOfficialQr('https://example.invalid/remote.png', 'synthetic-shop', 'fps', asset('synthetic-shop', '7').id, io));
    assert.deepEqual(readFileSync(old), bytes);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
