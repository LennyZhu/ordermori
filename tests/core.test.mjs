import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderStore } from '../src/data/store.ts';
import { blankInput, evaluate, parseCents, editable, toInput } from '../src/domain/model.ts';
import { hasDraftInput } from '../src/ui/home.ts';
import { SCHEMA_VERSION } from '../src/data/migrations.ts';

function fixture(shipping = 'custom') {
  return { buyer: '@test_buyer', items: [
    { id: 'item-a', name: '測試布袋', price: '88.50', quantity: '2' },
    { id: 'item-b', name: 'Test card', price: '39.90', quantity: '1' },
  ], shipping, shippingFee: shipping === 'custom' ? '30' : '0', discount: '16.90', note: '合成測試資料' };
}
let instanceCount = 0;
async function setup(path = ':memory:') {
  const db = new DatabaseSync(path);
  const port = {
    exec: async (sql) => { db.exec(sql); },
    run: async (sql, params = []) => db.prepare(sql).run(...params),
    first: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
  };
  let id = 0; let clock = 0; const prefix = ++instanceCount;
  const store = new OrderStore(port, () => `test-id-${prefix}-${++id}`, () => new Date(1700000000000 + clock++).toISOString());
  await store.initialize();
  return { db, store };
}
async function create(store, input = fixture()) {
  const draft = await store.openDraft();
  const id = await store.createOrder(draft.requestId, input);
  return { id, requestId: draft.requestId };
}

test('homepage only offers resume for entered draft content, not defaults or extra empty rows', () => {
  const blank = blankInput('a');
  assert.equal(hasDraftInput(null), false);
  assert.equal(hasDraftInput(blank), false);
  assert.equal(hasDraftInput({ ...blank, buyer: '  ', note: '\n ', items: [...blank.items, { id: 'b', name: '', price: '', quantity: '1' }] }), false);
  for (const change of [{ buyer: '@buyer' }, { note: '稍後補商品' }, { shipping: 'pickup' }, { discount: '0' }, { shippingFee: '5' }]) {
    assert.equal(hasDraftInput({ ...blank, ...change }), true);
  }
  for (const change of [{ name: '布袋' }, { price: '0' }, { quantity: '2' }, { quantity: '' }]) {
    assert.equal(hasDraftInput({ ...blank, items: [{ ...blank.items[0], ...change }] }), true);
  }
});

test('homepage draft read is read-only and reflects persisted input, closed drafts and creation', async () => {
  const { store, db } = await setup();
  try {
    const before = db.prepare('SELECT total_changes() AS n').get().n;
    assert.equal(await store.getDraftInput(), null);
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, before);
    assert.equal((await store.getHome()).hasDraft, false);
    const draft = await store.openDraft();
    const snapshot = db.prepare('SELECT * FROM drafts').get();
    assert.equal(hasDraftInput(await store.getDraftInput()), false);
    assert.deepEqual(db.prepare('SELECT * FROM drafts').get(), snapshot);
    const input = { ...draft.input, note: '未完成的實際輸入' };
    await store.saveDraft(draft.requestId, 1, input);
    assert.deepEqual(await store.getDraftInput(), input);
    assert.equal(hasDraftInput(await store.getDraftInput()), true);
    assert.equal((await store.getHome()).createdCount, 0);
    await store.discardDraft(draft.requestId);
    assert.equal(await store.getDraftInput(), null);
    await create(store);
    assert.equal(await store.getDraftInput(), null);
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('integer cents, delivery distinctions and invalid real orders', () => {
  assert.equal(parseCents('88.50'), 8850);
  assert.equal(parseCents('000.01'), 1);
  const custom = evaluate(fixture());
  assert.deepEqual([custom.subtotal, custom.discount, custom.shipping, custom.total], [21690, 1690, 3000, 23000]);
  for (const kind of ['sf_collect', 'included', 'pickup']) assert.equal(evaluate(fixture(kind)).total, 20000);
  for (const bad of ['-1', '1.001', '1e3', '.', 'NaN', '900719925474099.99']) assert.throws(() => parseCents(bad));
  assert.throws(() => evaluate({ ...fixture('sf_collect'), shippingFee: '30' }));
  assert.throws(() => evaluate({ ...fixture(), buyer: '' }));
  assert.throws(() => evaluate(blankInput('a')));
  assert.throws(() => evaluate(blankInput('a'), false));
  assert.throws(() => evaluate({ ...fixture(), items: [{ id: 'x', name: 'a', quantity: '1', price: '12.' }] }, false));
  assert.throws(() => evaluate({ ...fixture(), discount: '217' }));
  assert.throws(() => evaluate({ ...fixture(), items: [{ id: 'x', name: 'a', quantity: '0', price: '5' }] }));
  assert.throws(() => evaluate({ ...fixture(), items: [{ id: 'x', name: 'a', quantity: '1', price: '0' }], discount: '0', shippingFee: '0' }));
});

test('migration, physical persistence, incomplete draft, sequence ordering and tombstone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ordermori-core-'));
  let instance;
  try {
    const path = join(dir, 'orders.sqlite');
    instance = await setup(path);
    assert.equal(instance.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const draft = await instance.store.openDraft();
    const input = { ...blankInput('x'), note: '仍未填完', buyer: '' };
    await instance.store.saveDraft(draft.requestId, 3, input);
    await instance.store.saveDraft(draft.requestId, 2, blankInput('stale'));
    instance.db.close(); instance = await setup(path);
    const restored = await instance.store.openDraft();
    assert.equal(restored.editSeq, 3); assert.deepEqual(restored.input, input);
    assert.equal((await instance.store.getHome()).createdCount, 0);
    await instance.store.discardDraft(restored.requestId);
    assert.equal(await instance.store.saveDraft(restored.requestId, 9, input), false);
    assert.equal((await instance.store.getHome()).hasDraft, false);
    const saved = await create(instance.store);
    let savedOrder = (await instance.store.getOrder(saved.id)).order;
    await instance.store.changeStatus(saved.id, savedOrder.revision, 'mark_paid', '持久化測試');
    instance.db.close(); instance = await setup(path);
    savedOrder = (await instance.store.getOrder(saved.id)).order;
    assert.equal(savedOrder.total_cents, 23000);
    assert.equal(savedOrder.payment_status, 'paid');
    assert.ok(savedOrder.financial_locked_at);
    assert.equal((await instance.store.getHome()).createdCount, 1);
  } finally { instance?.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('first creation, snapshots, idempotent retry and no late draft resurrection', async () => {
  const { store, db } = await setup();
  try {
    await store.saveShop('測試舊店名', 'Old description');
    const { id, requestId } = await create(store);
    const original = await store.getOrder(id);
    assert.equal(original.order.total_cents, 23000);
    assert.equal(original.items.length, 2);
    assert.equal(original.items[0].unit_price_cents, 8850);
    assert.ok(original.items.every((item) => item.shop_id === original.order.shop_id));
    assert.equal(await store.createOrder(requestId, blankInput('invalid-retry')), id);
    assert.equal(await store.saveDraft(requestId, 100, fixture()), false);
    await store.saveShop('新店名', 'New description');
    assert.equal((await store.getOrder(id)).order.shop_name_snapshot, '測試舊店名');
    assert.equal((await store.getHome()).createdCount, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM creation_ledger').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM status_history').get().n, 1);
    assert.equal((await store.getHome('test_buyer', 'unpaid')).orders.length, 1);
    assert.equal((await store.getHome('OM-000001')).orders[0].id, id);
    assert.equal((await store.getHome('%')).orders.length, 0);
  } finally { db.close(); }
});

test('the final free slot is atomic, repeated submit returns original, sixteenth rejected', async () => {
  const { store, db } = await setup();
  try {
    for (let i = 0; i < 14; i++) await create(store);
    const draft = await store.openDraft();
    const values = await Promise.all([store.createOrder(draft.requestId, fixture()), store.createOrder(draft.requestId, fixture())]);
    assert.equal(values[0], values[1]);
    assert.equal((await store.getHome()).createdCount, 15);
    const next = await store.openDraft();
    await assert.rejects(store.createOrder(next.requestId, fixture()), error => error.code === 'quota');
    await assert.rejects(store.createOrder('unknown-request', fixture()));
    assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 15);
    assert.equal(db.prepare('SELECT count(*) AS n FROM order_items').get().n, 30);
    assert.equal(db.prepare('SELECT count(*) AS n FROM creation_ledger').get().n, 15);
    assert.throws(() => db.exec('UPDATE app_state SET created_count=0'));
    const order = (await store.getOrder(values[0])).order;
    await store.changeStatus(order.id, order.revision, 'cancel', '測試取消');
    assert.equal((await store.getHome()).createdCount, 15);
    assert.equal(await store.createOrder(draft.requestId, fixture()), order.id);
  } finally { db.close(); }
});

test('failure inside ledger or counter rolls back order, details, events, number and quota', async () => {
  for (const point of ['ledger', 'counter']) {
    const { store, db } = await setup();
    try {
      const draft = await store.openDraft();
      db.exec(point === 'ledger'
        ? "CREATE TRIGGER fail_create BEFORE INSERT ON creation_ledger BEGIN SELECT RAISE(ABORT,'injected'); END"
        : "CREATE TRIGGER fail_create BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'injected'); END");
      await assert.rejects(store.createOrder(draft.requestId, fixture()));
      for (const table of ['orders', 'order_items', 'creation_ledger', 'status_history']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
      const home = await store.getHome(); assert.equal(home.createdCount, 0); assert.equal(home.hasDraft, true);
      db.exec('DROP TRIGGER fail_create');
      const id = await store.createOrder(draft.requestId, fixture());
      assert.equal((await store.getOrder(id)).order.order_number, 'OM-000001');
    } finally { db.close(); }
  }
});

test('payment correction permanently locks financial snapshots and records real state history', async () => {
  const { store, db } = await setup();
  try {
    const { id } = await create(store);
    let detail = await store.getOrder(id);
    await assert.rejects(store.changeStatus(id, detail.order.revision, 'fulfill', ''));
    await store.updateOrder(id, detail.order.revision, { ...fixture(), buyer: '@changed' });
    detail = await store.getOrder(id);
    await store.changeStatus(id, detail.order.revision, 'mark_paid', '商家自行核對');
    detail = await store.getOrder(id);
    const firstLock = detail.order.financial_locked_at;
    await assert.rejects(store.changeStatus(id, detail.order.revision, 'cancel', ''));
    await assert.rejects(store.changeStatus(id, detail.order.revision, 'correct_payment', ''));
    await store.changeStatus(id, detail.order.revision, 'correct_payment', '誤標，實際尚未收款');
    detail = await store.getOrder(id);
    assert.equal(detail.order.payment_status, 'unpaid'); assert.equal(detail.order.financial_locked_at, firstLock);
    assert.equal(editable(detail.order), false);
    await assert.rejects(store.updateOrder(id, detail.order.revision, fixture()));
    assert.throws(() => db.prepare('UPDATE orders SET buyer_identifier=? WHERE id=?').run('wrong', id));
    assert.throws(() => db.prepare('UPDATE orders SET financial_locked_at=NULL WHERE id=?').run(id));
    assert.throws(() => db.prepare('UPDATE order_items SET name_snapshot=? WHERE order_id=?').run('wrong', id));
    assert.equal(detail.history.length, 3);
    assert.equal((await store.getHome()).createdCount, 1);
  } finally { db.close(); }
});

test('fulfilment mapping, full refund, terminal constraints and revision conflicts', async () => {
  for (const shipping of ['included', 'sf_collect', 'pickup', 'custom']) {
    const { store, db } = await setup();
    try {
      const { id } = await create(store, fixture(shipping));
      let detail = await store.getOrder(id);
      const stale = detail.order.revision;
      await store.changeStatus(id, stale, 'mark_paid', '自行確認');
      await assert.rejects(store.changeStatus(id, stale, 'fulfill', ''), (error) => error.code === 'conflict');
      detail = await store.getOrder(id);
      assert.equal((await store.getHome('', 'fulfillment')).orders.length, 1);
      await store.changeStatus(id, detail.order.revision, 'fulfill', '');
      detail = await store.getOrder(id);
      assert.equal(detail.order.fulfillment_status, shipping === 'pickup' ? 'handed_over' : 'shipped');
      assert.equal((await store.getHome('', 'completed')).orders.length, 1);
      await assert.rejects(store.changeStatus(id, detail.order.revision, 'cancel', ''));
      await store.changeStatus(id, detail.order.revision, 'refund', '已在外部完成整單退款');
      detail = await store.getOrder(id);
      assert.equal(detail.order.refunded_amount_cents, detail.order.total_cents);
      assert.notEqual(detail.order.fulfillment_status, 'pending');
      await assert.rejects(store.changeStatus(id, detail.order.revision, 'mark_paid', ''));
      await assert.rejects(store.changeStatus(id, detail.order.revision, 'cancel', ''));
      assert.equal((await store.getHome()).createdCount, 1);
    } finally { db.close(); }
  }
});

test('refunded pending orders can cancel; foreign shop references and newer schemas are rejected', async () => {
  const { store, db } = await setup();
  try {
    const { id } = await create(store);
    let detail = await store.getOrder(id);
    await store.changeStatus(id, detail.order.revision, 'mark_paid', '');
    detail = await store.getOrder(id);
    await store.changeStatus(id, detail.order.revision, 'refund', '已外部退款');
    detail = await store.getOrder(id);
    await store.changeStatus(id, detail.order.revision, 'cancel', '退款後取消');
    detail = await store.getOrder(id);
    assert.equal(detail.order.order_status, 'cancelled');
    await assert.rejects(store.updateOrder(id, detail.order.revision, toInput(detail)));
    const second = await create(store);
    assert.throws(() => db.prepare('INSERT INTO order_items(id,order_id,shop_id,position,name_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,99,?,1,100,100)').run('wrong-id', second.id, 'other-shop', 'x'), /FOREIGN KEY/);
    db.exec('PRAGMA user_version=99');
    await assert.rejects(store.initialize(), (error) => error.code === 'version');
    assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 2);
  } finally { db.close(); }
});

test('missing existing profile fails safely instead of resetting quota or shop', async () => {
  const { store, db } = await setup();
  try {
    await create(store);
    db.exec('DELETE FROM app_state');
    await assert.rejects(store.initialize(), (error) => error.code === 'data');
    assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM shops').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM creation_ledger').get().n, 1);
  } finally { db.close(); }
});
