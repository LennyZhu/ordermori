import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { OrderStore } from '../src/data/store.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { blankInput } from '../src/domain/model.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { checkSchema, migrateInspected, readBackupData, replaceData, TABLES, validateData } from '../src/backup/data.ts';
import { fixture, DATE } from './helpers/notice-bilingual.mjs';
import { buildNotice, noticeSourceKey } from '../src/domain/notice.ts';
import { schemaDifferences } from '../src/backup/schemaDiagnostics.ts';
import { writeArchive, inspectArchive, copyEntry } from '../src/backup/archive.ts';

const historicalV3=readFileSync(new URL('./fixtures/backup-legacy-v3-schema.sql',import.meta.url),'utf8');
const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,args=[])=>db.prepare(sql).run(...args),first:async(sql,args=[])=>db.prepare(sql).get(...args)??null,all:async(sql,args=[])=>db.prepare(sql).all(...args)});
const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};
const metadata=db=>db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name').all();
const norm=sql=>sql===null?null:sql.trim().replace(/\s+/g,' ');
async function historical(path=':memory:',brokenV4=false){
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
  // Continuous release upgrades: original v1, original v2, fixed historical
  // v3 fixture, then shipped v4/v5/v6 on the existing database.
  for(const migration of MIGRATIONS.filter(m=>m.version<=2)){db.exec(migration.sql);db.exec(`PRAGMA user_version=${migration.version}`);}
  db.exec(historicalV3);db.exec(`PRAGMA user_version=${brokenV4?4:3}`);
  db.exec("INSERT INTO shops VALUES('synthetic-shop','合成舊店舖','','2026-01-01'); INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,'synthetic-profile','synthetic-shop')");
  const store=new OrderStore(port(db),randomUUID,()=> '2026-01-01T00:00:00.000Z');await store.initialize();return {db,store};
}

test('independent historical v1 -> current fixture reproduces the exact observed preference table and original guard set',async()=>{
  for(const broken of [false,true]){
    const {db}=await historical(':memory:',broken);try{
      const before=metadata(db),reports=[];assert.equal(await checkSchema(port(db),reference,r=>reports.push(r)),SCHEMA_VERSION);
      const guards=before.filter(o=>o.type==='trigger'&&o.tbl_name==='notice_preferences');assert.deepEqual(guards.map(g=>g.name),['locked_notice_preferences']);
      const table=before.find(o=>o.name==='notice_preferences');
      assert.match(norm(table.sql),/include_note INTEGER NOT NULL CHECK\(include_note IN \(0,1\)\), revision INTEGER NOT NULL CHECK\(revision>0\), note_snapshot TEXT NOT NULL DEFAULT '', output_locale TEXT NOT NULL DEFAULT 'zh-HK' CHECK\(output_locale IN \('zh-HK','en'\)\), hide_branding INTEGER NOT NULL DEFAULT 0 CHECK\(hide_branding IN \(0,1\)\), FOREIGN KEY/);
      assert.equal(reports[0].outcome,'legacy-compatible');assert.equal(reports[0].reference,'early-v3-original-guards');
      assert.equal(reports[0].objects.filter(o=>o.rule==='missing_object').length,2);
      assert.deepEqual(metadata(db),before); // Compatibility did not repair live schema.
    }finally{db.close();}
  }
});

test('fresh current schema and all real internal autoindexes are accepted; SQL-NULL unrelated objects are not ignored',async()=>{
  const db=new DatabaseSync(':memory:');try{
    await new OrderStore(port(db),randomUUID).initialize();const actual=metadata(db),reports=[];
    const indexes=actual.filter(o=>o.sql===null);assert.ok(indexes.length>0);assert.ok(indexes.every(o=>o.type==='index'&&o.name.startsWith(`sqlite_autoindex_${o.tbl_name}_`)));
    assert.equal(await checkSchema(port(db),reference,r=>reports.push(r)),SCHEMA_VERSION);assert.deepEqual(reports,[]);
    const extra={type:'table',name:'unexpected_null_sql',tbl_name:'unexpected_null_sql',sql:null};
    const forged={...port(db),all:async sql=>sql.includes('FROM main.sqlite_master')?[...actual,extra]:port(db).all(sql)};
    await assert.rejects(checkSchema(forged,reference,r=>reports.push(r)));
    assert.ok(reports.at(-1).objects.some(o=>o.name===extra.name&&o.rule==='unexpected_object'));
  }finally{db.close();}
});

test('partial loss, missing business indexes, changed guards and unrelated triggers still reject without touching data',async()=>{
  for(const change of ['partial','index','guard','unrelated','stats']){
    const {db}=await historical();try{
      if(change==='partial')db.exec("CREATE TRIGGER locked_notice_preferences_insert BEFORE INSERT ON notice_preferences BEGIN SELECT RAISE(ABORT,'not the shipped guard'); END");
      if(change==='index')db.exec('DROP INDEX orders_shop_created');
      if(change==='guard')db.exec("DROP TRIGGER locked_notice_preferences; CREATE TRIGGER locked_notice_preferences BEFORE UPDATE ON notice_preferences BEGIN SELECT 1; END");
      if(change==='unrelated')db.exec('CREATE TRIGGER third_party AFTER INSERT ON shops BEGIN DELETE FROM orders; END');
      if(change==='stats')db.exec('ANALYZE'); // No broad sqlite_* exemption.
      const before=metadata(db),state=db.prepare('SELECT * FROM app_state').all(),reports=[];
      await assert.rejects(checkSchema(port(db),reference,r=>reports.push(r)),e=>e.code==='backup');
      assert.equal(reports.at(-1).outcome,'rejected');assert.ok(reports.at(-1).objects.every(o=>o.type&&o.name&&o.tbl_name&&o.rule&&o.reason));
      if(change==='index')assert.ok(reports.at(-1).objects.some(o=>o.name==='orders_shop_created'&&o.rule==='missing_object'));
      if(change==='stats')assert.ok(reports.at(-1).objects.some(o=>o.name==='sqlite_stat1'&&o.rule==='unexpected_internal_object'));
      assert.deepEqual(metadata(db),before);assert.deepEqual(db.prepare('SELECT * FROM app_state').all(),state);
    }finally{db.close();}
  }
  // One genuinely shipped guard restored alone is not the observed legacy pair.
  const {db}=await historical();try{
    const ref=await reference();try{for(const m of MIGRATIONS.filter(m=>m.version<=3))await ref.db.exec(m.sql);const trigger=await ref.db.first("SELECT sql FROM sqlite_master WHERE name='locked_notice_preferences_insert'");db.exec(trigger.sql);}finally{await ref.close();}
    await assert.rejects(checkSchema(port(db),reference));
  }finally{db.close();}
});

test('diagnostics contain only bounded structural identifiers/rules, never SQL literals, business rows or raw errors',()=>{
  const actual=[{type:'table',name:'untrusted private name',tbl_name:'buyer@example.invalid',sql:"CREATE TABLE x AS SELECT 'SENSITIVE-LITERAL'"}];
  const problems=schemaDifferences(actual,[]);assert.equal(problems[0].rule,'unexpected_object');
  const json=JSON.stringify(problems);assert.doesNotMatch(json,/SENSITIVE|buyer@|SELECT|CREATE|untrusted private/);assert.match(json,/nonstandard identifier/);
});

test('real WAL backup of historical schema passes the shared export/import guard and restores into fresh trusted schema',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-schema-history-'));const {db,store}=await historical(join(dir,'live.sqlite'),true);
  const target=new DatabaseSync(':memory:');try{
    await store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC',accountNumber:'NOT REAL',confirmed:true});
    const method=(await store.getPaymentSettings()).methods[0];const draft=await store.openDraft();
    const id=await store.createOrder(draft.requestId,{...blankInput(randomUUID()),buyer:'synthetic only',items:[{id:randomUUID(),name:'合成商品',quantity:'3',price:'39.00'}],payment:snapshotOf(method)});
    await store.saveNoticePreferences(id,1,0,{template:'soft',includeNote:false});await store.changeStatus(id,1,'mark_paid','合成付款');
    const before=await readBackupData(port(db));
    execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()',join(dir,'live.sqlite'),join(dir,'snapshot.sqlite')]);
    const bytes=readFileSync(join(dir,'snapshot.sqlite')),chunks=[];
    const source=b=>({size:b.length,read:async(at,n)=>new Uint8Array(b.subarray(at,at+n))});
    await writeArchive([{path:'manifest.json',source:source(Buffer.from('{}'))},{path:'data.sqlite',source:source(bytes)}],{write:async b=>{chunks.push(Buffer.from(b));}});
    const zipped=Buffer.concat(chunks),entries=await inspectArchive(source(zipped)),out=[];
    await copyEntry(source(zipped),entries.find(e=>e.path==='data.sqlite'),{write:async b=>{out.push(Buffer.from(b));}});writeFileSync(join(dir,'import.sqlite'),Buffer.concat(out));
    const imported=new DatabaseSync(join(dir,'import.sqlite'));try{
      assert.equal(await checkSchema(port(imported),reference),SCHEMA_VERSION);const data=await readBackupData(port(imported));
      const targetStore=new OrderStore(port(target),randomUUID);await targetStore.initialize();
      await targetStore.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),'2026-01-01T00:00:00.000Z'));
      const restored=await readBackupData(port(target));assert.deepEqual(restored.orders,before.orders);assert.deepEqual(restored.order_payment_snapshots,before.order_payment_snapshots);assert.deepEqual(restored.notice_preferences,before.notice_preferences);
      assert.equal(await checkSchema(port(target),reference),SCHEMA_VERSION); // Fresh target keeps all three guards.
      assert.equal(metadata(target).filter(o=>o.type==='trigger'&&o.tbl_name==='notice_preferences').length,3);
      assert.deepEqual(await readBackupData(port(db)),before);
    }finally{imported.close();}
  }finally{db.close();target.close();rmSync(dir,{recursive:true,force:true});}
});

const hash = text => createHash('sha256').update(text).digest('hex');
const paymentImage = (kind, shopId, suffix) => {
  const id = `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
  return { id, shopId, kind, relativePath: `payment-assets/${id}.png`, mime: 'image/png', bytes: 68,
    sha256: 'a'.repeat(64), width: 1, height: 1 };
};
const rawData = db => Object.fromEntries(TABLES.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

async function seedLegacyPayments(f) {
  await f.store.saveShop('合成店舖', '');
  const shop = await f.store.getShop();
  const sources = [];
  for (const kind of ['fps', 'payme', 'bank']) {
    const photo = kind === 'bank' ? null : paymentImage(kind, shop.id, sources.length + 1);
    if (photo) await f.store.registerPaymentAsset(photo);
    await f.store.savePaymentMethod(kind, {
      ...emptyPayment(), confirmed: true, qrAssetId: photo?.id ?? null,
      ...(kind === 'bank' ? { bankName: 'TEST', accountName: 'TEST', accountNumber: 'TEST' } : {}),
    });
    const method = (await f.store.getPaymentSettings()).methods.find(entry => entry.kind === kind);
    await f.store.setDefaultPaymentMethod(method.methodId);
    const draft = await f.store.openDraft();
    const input = { ...draft.input, buyer: 'synthetic', items: [{ id: 'item', name: 'Synthetic', price: '1', quantity: '1' }] };
    const id = await f.store.createOrder(draft.requestId, input);
    const doc = buildNotice(await f.store.getNoticeContext(id));
    const fileId = randomUUID();
    const source = noticeSourceKey(doc);
    await f.store.recordNoticeFile({ id: fileId, orderId: id, shopId: shop.id, orderRevision: doc.orderRevision,
      preferencesRevision: doc.preferencesRevision, template: doc.template, locale: doc.locale,
      relativePath: `payment-notices/${fileId}.png`, width: 1080, height: 1, bytes: 68, sha256: 'b'.repeat(64),
      dataHash: hash(source), createdAt: DATE }, source);
    sources.push({ id, source });
  }
  await f.store.changeStatus(sources[0].id, 1, 'mark_paid', 'synthetic');
  await f.store.openDraft();
  return sources;
}

test('v10 live and inspection-copy paths preserve every row and converge with fresh v11', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'ordermori-v11-'));
  const f = await fixture(10, false, join(folder, 'legacy.sqlite'));
  const fresh = new DatabaseSync(':memory:');
  let copy;
  try {
    const sources = await seedLegacyPayments(f);
    const before = rawData(f.db);
    const priorSchema = metadata(f.db);
    assert.equal(await checkSchema(f.adapter, reference), 10);
    await f.adapter.exec('PRAGMA query_only=OFF');
    const copyPath = join(folder, 'staged.sqlite');
    f.db.prepare('VACUUM INTO ?').run(copyPath);
    copy = new DatabaseSync(copyPath);
    assert.equal(await checkSchema(port(copy), reference), 10);
    await migrateInspected(port(copy));
    await f.store.initialize();
    const freshPort = port(fresh);
    await new OrderStore(freshPort, randomUUID, () => DATE).initialize();
    for (const [db, adapter] of [[f.db, f.adapter], [copy, port(copy)], [fresh, freshPort]]) {
      assert.equal(await checkSchema(adapter, reference), 11);
      assert.deepEqual(metadata(db), metadata(fresh));
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    }
    assert.deepEqual(rawData(f.db), before);
    assert.deepEqual(rawData(copy), before);
    assert.equal((await readBackupData(port(copy))).notice_files.length, 3);
    for (const { id, source } of sources.slice(1)) {
      assert.equal(noticeSourceKey(buildNotice(await f.store.getNoticeContext(id))), source);
    }
    for (const { id, source } of sources) {
      assert.equal(f.db.prepare('SELECT data_hash FROM notice_files WHERE order_id=?').get(id).data_hash, hash(source));
    }
    await f.adapter.exec('PRAGMA query_only=OFF');
    assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS total FROM sqlite_schema WHERE type='index' AND tbl_name IN ('payment_assets','payment_methods','order_payment_snapshots','shop_payment_defaults')").get().total, 8);
    assert.throws(() => f.db.prepare('UPDATE order_payment_snapshots SET payload=payload WHERE order_id=?').run(sources[0].id), /snapshot is locked/);
    assert.throws(() => f.db.prepare('DELETE FROM order_payment_snapshots WHERE order_id=?').run(sources[0].id), /snapshot is locked/);
    assert.throws(() => f.db.prepare('UPDATE payment_assets SET sha256=sha256').run(), /metadata is immutable/);
    assert.deepEqual(metadata(f.db).filter(row => row.type === 'trigger'), priorSchema.filter(row => row.type === 'trigger'));
    assert.throws(() => f.db.prepare('UPDATE shop_payment_defaults SET method_id=?').run('absent'), /FOREIGN KEY/);
  } finally {
    copy?.close();
    fresh.close();
    f.db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('v11 failure after table rebuild and data copy rolls back data, schema and user_version', async () => {
  const f = await fixture(10);
  try {
    await seedLegacyPayments(f);
    const before = rawData(f.db);
    const schema = metadata(f.db);
    let injected = false;
    const broken = { ...f.adapter, async exec(sql) {
      await f.adapter.exec(sql);
      if (sql.includes('CREATE TEMP TABLE v11_payment_assets')) {
        assert.equal(f.db.prepare('SELECT count(*) AS total FROM order_payment_snapshots').get().total, 3);
        assert.match(metadata(f.db).find(row => row.name === 'payment_assets').sql, /alipayhk/);
        injected = true;
        throw new Error('injected after v11 row copy');
      }
    } };
    await assert.rejects(new OrderStore(broken, randomUUID, () => DATE).initialize(), /injected after v11 row copy/);
    assert.equal(injected, true);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 10);
    assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.deepEqual(metadata(f.db), schema);
    assert.deepEqual(rawData(f.db), before);
    assert.deepEqual(f.db.prepare('SELECT name FROM sqlite_temp_schema').all(), []);
    await f.store.initialize();
    assert.equal(await checkSchema(f.adapter, reference), 11);
  } finally { f.db.close(); }
});

test('v11 backup row restore preserves new QR methods and rejects invalid logical asset links', async () => {
  const f = await fixture();
  const target = await fixture();
  try {
    const shop = await f.store.getShop();
    await f.store.saveShop('合成店舖', '');
    for (const [i, kind] of ['alipayhk', 'wechat_pay_hk'].entries()) {
      const photo = paymentImage(kind, shop.id, i + 1);
      await f.store.registerPaymentAsset(photo);
      await f.store.savePaymentMethod(kind, { ...emptyPayment(), accountName: ' Synthetic ', confirmed: true, qrAssetId: photo.id });
      const method = (await f.store.getPaymentSettings()).methods.find(entry => entry.kind === kind);
      await f.store.setDefaultPaymentMethod(method.methodId);
      const draft = await f.store.openDraft();
      const orderId = await f.store.createOrder(draft.requestId, { ...draft.input, buyer: 'synthetic',
        items: [{ id: 'item', name: 'Synthetic', price: '1', quantity: '1' }] });
      const document = buildNotice(await f.store.getNoticeContext(orderId));
      assert.equal(document.payment.accountName, ' Synthetic ');
      assert.equal(document.payment.version, 1);
      assert.equal(document.qr.id, photo.id);
    }
    await f.store.openDraft();
    const data = await readBackupData(f.adapter);
    assert.equal(await checkSchema(f.adapter, reference), 11);
    const mutateDraft = (copy, mutate) => {
      const payload = JSON.parse(copy.drafts[0].payload);
      mutate(payload.input.payment);
      copy.drafts[0].payload = JSON.stringify(payload);
    };
    for (const mutate of [
      copy => mutateDraft(copy, payment => { payment.qrAssetId = copy.payment_assets[0].id; }),
      copy => mutateDraft(copy, payment => { payment.qrAssetId = 'missing'; }),
      copy => mutateDraft(copy, payment => { payment.shopId = 'other-shop'; }),
      copy => mutateDraft(copy, payment => { payment.kind = 'unknown'; }),
      copy => mutateDraft(copy, payment => { payment.unexpected = true; }),
      copy => { copy.payment_assets[0].kind = 'bank'; },
      copy => { copy.payment_assets[0].shop_id = 'other-shop'; },
      copy => { copy.payment_assets[0].kind = 'wechat_pay_hk'; },
      copy => { copy.payment_methods[0].kind = 'unknown'; },
    ]) {
      const invalid = structuredClone(data);
      mutate(invalid);
      assert.throws(() => validateData(invalid));
    }
    await target.store.maintenance(db => replaceData(db, data, randomUUID(), randomUUID(), DATE));
    const restored = await readBackupData(target.adapter);
    for (const table of ['payment_assets', 'payment_methods', 'order_payment_snapshots', 'shop_payment_defaults', 'drafts']) {
      assert.deepEqual(restored[table], data[table]);
    }
  } finally { target.db.close(); f.db.close(); }
});

test('v11 backups preserve unfinished payment settings, a blank optional payee and an unassigned draft', async () => {
  const f = await fixture();
  const target = await fixture();
  try {
    await f.store.savePaymentMethod('alipayhk', { ...emptyPayment(), accountName: ' Synthetic ' });
    await f.store.savePaymentMethod('wechat_pay_hk', emptyPayment());
    const draft = await f.store.openDraft();
    assert.equal(draft.input.payment, null);
    const data = await readBackupData(f.adapter);
    assert.equal(validateData(data).media, 0);
    await target.store.maintenance(db => replaceData(db, data, randomUUID(), randomUUID(), DATE));
    const restored = await target.store.getPaymentSettings();
    assert.deepEqual(restored.methods.map(({ kind, status, accountName }) => ({ kind, status, accountName })), [
      { kind: 'alipayhk', status: 'incomplete', accountName: ' Synthetic ' },
      { kind: 'wechat_pay_hk', status: 'not_configured', accountName: '' },
    ]);
    assert.equal(restored.defaultMethodId, null);
    assert.equal((await target.store.openDraft()).input.payment, null);
  } finally { target.db.close(); f.db.close(); }
});
