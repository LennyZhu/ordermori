import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { OrderStore } from '../src/data/store.ts';
import { FREE_LIMIT, blankInput, toInput } from '../src/domain/model.ts';
import { freeOrderPermission, hongKongMonth, nextHongKongMonth, quotaRefreshDelay, QUOTA_EXHAUSTED } from '../src/domain/quota.ts';
import { readBackupData, replaceData, checkSchema, migrateInspected, validateData } from '../src/backup/data.ts';
import { verifySummary } from '../src/backup/manifest.ts';
import { language, tr, trMessage } from '../src/i18n/index.ts';
import { fixture as legacyFixture, order as legacyOrder } from './helpers/notice-bilingual.mjs';

const DATE='2026-10-30T04:00:00.000Z';
const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};
const input=()=>({...blankInput(randomUUID()),buyer:'SYNTHETIC buyer',items:[{id:randomUUID(),name:'合成商品 Product',price:'128.00',quantity:'1'}]});
async function fixture(path=':memory:') {
  const db=new DatabaseSync(path),adapter=port(db),clock={now:DATE},store=new OrderStore(adapter,randomUUID,()=>clock.now);
  await store.initialize();return {db,adapter,store,clock};
}
async function create(f){const draft=await f.store.openDraft();return f.store.createOrder(draft.requestId,input());}
async function restore(f,data,afterRows){return f.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),f.clock.now,afterRows));}

test('Hong Kong month boundaries, first second, year transition and device timezone are deterministic',()=>{
  for(const [iso,period] of [['2026-10-31T15:59:59.999Z','2026-10'],['2026-10-31T16:00:00.000Z','2026-11'],['2026-12-31T15:59:59.999Z','2026-12'],['2026-12-31T16:00:00.000Z','2027-01']])assert.equal(hongKongMonth(iso),period);
  const old=process.env.TZ;try{for(const zone of ['UTC','America/Los_Angeles','Asia/Tokyo']){process.env.TZ=zone;assert.equal(hongKongMonth('2026-10-31T16:00:00Z'),'2026-11');}}finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
  assert.equal(nextHongKongMonth('2026-12'),'2026-12-31T16:00:00.000Z');assert.throws(()=>hongKongMonth('not a date'));
  assert.equal(quotaRefreshDelay('2026-10-31T16:00:00.000Z',Date.parse('2026-10-31T15:59:59.000Z')),1000);
  assert.equal(quotaRefreshDelay(nextHongKongMonth('2026-10'),Date.parse(DATE)),60000);
});

test('15 real creations, unlimited draft edits, single charge for double click/retry, and the 16th is blocked',async()=>{
  const f=await fixture();try{
    const d=await f.store.openDraft();for(let n=1;n<=30;n++)await f.store.saveDraft(d.requestId,n,{...d.input,note:`synthetic draft ${n}`});assert.equal((await f.store.getQuota()).used,0);
    for(let i=0;i<14;i++)await create(f);const last=await f.store.openDraft();
    const ids=await Promise.all(Array.from({length:12},()=>f.store.createOrder(last.requestId,input())));assert.equal(new Set(ids).size,1);
    assert.equal(await f.store.createOrder(last.requestId,blankInput('invalid retry')),ids[0]);
    const q=await f.store.getQuota();assert.equal(q.used,15);assert.equal(q.remaining,0);assert.equal(q.canCreate,false);
    const next=await f.store.openDraft();await f.store.saveDraft(next.requestId,1,input());
    await assert.rejects(f.store.createOrder(next.requestId,input()),e=>e.code==='quota');
    assert.equal((await f.store.getQuota()).used,15);assert.equal((await f.store.getHome()).createdCount,15);assert.equal((await f.store.getHome()).hasDraft,true);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM quota_events').get().n,15);
  }finally{f.db.close();}
});

test('edits, cancellation, refund, catalog operations and draft disposal do not refund or charge',async()=>{
  const f=await fixture();try{const ids=[];for(let i=0;i<3;i++)ids.push(await create(f));
    const detail=await f.store.getOrder(ids[0]);await f.store.updateOrder(ids[0],1,{...toInput(detail),note:'changed'});
    await f.store.changeStatus(ids[1],1,'cancel','synthetic cancellation');await f.store.changeStatus(ids[2],1,'mark_paid','synthetic payment');await f.store.changeStatus(ids[2],2,'refund','synthetic refund');
    const product=await f.store.saveProduct({name:'Synthetic product',price:'9.99'});await f.store.deleteProduct(product,1);
    const draft=await f.store.openDraft();await f.store.discardDraft(draft.requestId);assert.equal((await f.store.getQuota()).used,3);
    assert.throws(()=>f.db.exec('DELETE FROM quota_events'),/retained/);assert.throws(()=>f.db.exec("UPDATE quota_events SET period='2026-11'"),/immutable/);
  }finally{f.db.close();}
});

test('failure before/after quota insertion rolls back the order, items, lifetime/monthly evidence and draft transition',async()=>{
  for(const table of ['orders','creation_ledger','quota_events','status_history']){const f=await fixture();try{
    const draft=await f.store.openDraft(),before=await readBackupData(f.adapter);
    f.db.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic failure'); END`);
    await assert.rejects(f.store.createOrder(draft.requestId,input()));f.db.exec('DROP TRIGGER injected_failure');
    assert.deepEqual(await readBackupData(f.adapter),before);assert.equal((await f.store.getQuota()).used,0);
    await f.store.createOrder(draft.requestId,input());assert.equal((await f.store.getQuota()).used,1);
  }finally{f.db.close();}}
});

test('two real SQLite connections racing the last monthly slot cannot double-create or double-charge',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-monthly-race-')),path=join(dir,'db.sqlite'),f=await fixture(path);
  try{for(let n=0;n<14;n++)await create(f);const draft=await f.store.openDraft();
    const race=()=>new Promise((resolve,reject)=>{const w=new Worker(new URL('./helpers/quota-worker.mjs',import.meta.url),{workerData:{path,requestId:draft.requestId,input:input(),now:DATE},execArgv:['--experimental-strip-types']});w.once('message',m=>m.error?reject(Error(m.error)):resolve(m.id));w.once('error',reject);w.once('exit',c=>{if(c)reject(Error(`worker ${c}`));});});
    const [a,b]=await Promise.all([race(),race()]);assert.equal(a,b);assert.equal((await f.store.getQuota()).used,15);assert.equal((await f.store.getHome()).orders.length,15);
    const next=await f.store.openDraft();await assert.rejects(f.store.createOrder(next.requestId,input()),e=>e.code==='quota');
  }finally{f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('live refresh, foreground read and reopening cross months without clearing older evidence or applying lifetime caps',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-monthly-reopen-')),path=join(dir,'db.sqlite'),f=await fixture(path);let reopened;
  try{for(let i=0;i<15;i++)await create(f);f.clock.now='2026-10-31T16:00:00.000Z';
    assert.equal((await f.store.getHome()).quota.used,0);await create(f);assert.equal((await f.store.getQuota()).used,1);assert.equal((await f.store.getHome()).createdCount,16);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM quota_events WHERE period=?').get('2026-10').n,15);
    f.db.close();reopened=new DatabaseSync(path);const store=new OrderStore(port(reopened),randomUUID,()=> '2027-01-01T00:00:00Z');await store.initialize();await store.initialize();
    assert.equal((await store.getQuota()).period,'2027-01');assert.equal((await store.getQuota()).used,0);assert.equal((await store.getHome()).createdCount,16);
    const provider=readFileSync('src/AppProvider.tsx','utf8');assert.match(provider,/AppState.addEventListener\('change'/);assert.match(provider,/quotaRefreshDelay/);
  }finally{if(f.db.isOpen)f.db.close();reopened?.close();rmSync(dir,{recursive:true,force:true});}
});

test('recorded highest month blocks backward-clock re-grants, persists across restart, and keeps drafts editable',async()=>{
  const f=await fixture();try{await create(f);f.clock.now='2026-11-01T00:00:00Z';await create(f);f.clock.now=DATE;
    const q=await f.store.getQuota();assert.equal(q.period,'2026-11');assert.equal(q.clockRollback,true);assert.equal(q.canCreate,false);
    const draft=await f.store.openDraft();assert.equal(await f.store.saveDraft(draft.requestId,1,input()),true);await assert.rejects(f.store.createOrder(draft.requestId,input()),e=>e.code==='quota_clock');
    await f.store.initialize();assert.equal((await f.store.getQuota()).clockRollback,true);
    assert.throws(()=>f.db.exec("UPDATE quota_state SET highest_period='2026-10'"),/rewind/);
    f.clock.now='2026-11-02T00:00:00Z';await f.store.createOrder(draft.requestId,input());assert.equal((await f.store.getQuota()).used,2);
  }finally{f.db.close();}
});

test('v6/v7/v8 lifetime-ten databases migrate once, preserve every old row and grant 15 monthly creations prospectively',async()=>{
  for(const version of [6,7,8]){const f=await legacyFixture(version,true);try{
    for(let i=0;i<10;i++)await legacyOrder(f);const tables=['shops','app_state','orders','order_items','creation_ledger','drafts','status_history','payment_methods','order_payment_snapshots','notice_files'];
    const rows=()=>Object.fromEntries(tables.map(t=>[t,f.db.prepare(`SELECT * FROM ${t}`).all()]));const before=rows();await f.store.initialize();await f.store.initialize();
    assert.deepEqual(rows(),before);assert.equal((await f.store.getQuota()).used,0);assert.equal((await f.store.getHome()).createdCount,10);
    assert.equal(f.db.prepare('SELECT count(*) n FROM quota_events WHERE period IS NULL').get().n,10);
    for(let n=0;n<15;n++){const draft=await f.store.openDraft();await f.store.createOrder(draft.requestId,input());}
    assert.equal((await f.store.getQuota()).used,15);assert.equal((await f.store.getHome()).createdCount,25);
    const draft=await f.store.openDraft();await assert.rejects(f.store.createOrder(draft.requestId,input()),e=>e.code==='quota');
    assert.equal(await checkSchema(f.adapter,reference),9);
  }finally{f.db.close();}}
});

test('v9 migration rollback is atomic, retryable and does not partially activate allowance',async()=>{
  const f=await legacyFixture(8,true);try{await legacyOrder(f);const before=f.db.prepare('SELECT * FROM app_state').all();
    const broken={...f.adapter,exec:async sql=>{await f.adapter.exec(sql);if(sql.includes('CREATE TABLE quota_events'))throw Error('synthetic v9 migration failure');}};
    await assert.rejects(new OrderStore(broken,randomUUID,()=>DATE).initialize());assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,8);assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'quota_%'").get().n,0);assert.deepEqual(f.db.prepare('SELECT * FROM app_state').all(),before);
    await f.store.initialize();assert.equal((await f.store.getQuota()).used,0);
  }finally{f.db.close();}
});

test('same-month 8 -> backup 3 restores retain 8; repeat restore and past draft retry never reissue creations',async()=>{
  const f=await fixture();try{for(let n=0;n<3;n++)await create(f);const pending=await f.store.openDraft(),data=await readBackupData(f.adapter);
    await f.store.createOrder(pending.requestId,input());for(let n=0;n<4;n++)await create(f);assert.equal((await f.store.getQuota()).used,8);
    for(let n=0;n<2;n++){await restore(f,data);assert.equal((await f.store.getQuota()).used,8);assert.equal((await f.store.getHome()).orders.length,3);}
    await assert.rejects(f.store.createOrder(pending.requestId,input()),e=>e.code==='request_created');assert.equal((await f.store.getQuota()).used,8);
    await f.store.discardDraft(pending.requestId);await create(f);assert.equal((await f.store.getQuota()).used,9);
  }finally{f.db.close();}
});

test('a pre-migration order cannot be recreated from a pre-conversion v8 draft restored later',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-legacy-draft-')),path=join(dir,'live.sqlite'),copy=join(dir,'old.sqlite'),f=await legacyFixture(8,true,path);let stage;
  try{const draft=await f.store.openDraft();execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()',path,copy]);
    stage=new DatabaseSync(copy);await checkSchema(port(stage),reference);await migrateInspected(port(stage));const old=await readBackupData(port(stage));
    await legacyOrder(f);await f.store.initialize();assert.equal((await f.store.getQuota()).used,0);
    await f.store.maintenance(db=>replaceData(db,old,randomUUID(),randomUUID(),DATE));assert.equal((await f.store.getHome()).orders.length,0);
    await assert.rejects(f.store.createOrder(draft.requestId,input()),e=>e.code==='request_created');assert.equal((await f.store.getQuota()).used,0);
  }finally{stage?.close();f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('monthly backup fields, charged timestamps, high-water and summary are validated without trusting a Pro flag',async()=>{
  const f=await fixture();try{await create(f);const data=await readBackupData(f.adapter),summary=validateData(data);
    const corrupt=edit=>{const d=structuredClone(data);edit(d);assert.throws(()=>validateData(d));};
    corrupt(d=>{d.quota_state[0].highest_period='2026-09';});corrupt(d=>{d.quota_events[0].recorded_at='2026-11-01T00:00:00Z';});
    corrupt(d=>{d.quota_state[0].is_pro=1;});corrupt(d=>{d.quota_events.push({...d.quota_events[0]});});
    assert.throws(()=>verifySummary({schemaVersion:9,summary:{...summary,quotaUsed:0}},summary),/月度額度摘要/);
    f.db.exec('CREATE TRIGGER untrusted_quota AFTER INSERT ON quota_events BEGIN SELECT 1; END');await assert.rejects(checkSchema(f.adapter,reference));
    f.db.exec('PRAGMA query_only=OFF; DROP TRIGGER untrusted_quota');assert.deepEqual(await readBackupData(f.adapter),data);
  }finally{f.db.close();}
});

test('old v6/v7/v8 backups migrate on staging without activating quota or resetting retained current use/highest month',async()=>{
  for(const version of [6,7,8]){const local=await fixture(),old=await legacyFixture(version,true);try{
    for(let n=0;n<8;n++)await create(local);await legacyOrder(old);await checkSchema(old.adapter,reference);await migrateInspected(old.adapter);
    const data=await readBackupData(old.adapter);assert.equal(data.quota_state[0].started_at,null);assert.equal(data.quota_events.length,1);assert.equal(data.quota_events[0].period,null);
    await restore(local,data);assert.equal((await local.store.getQuota()).used,8);local.clock.now='2026-11-01T00:00:00Z';await create(local);
    await restore(local,data);local.clock.now=DATE;assert.equal((await local.store.getQuota()).period,'2026-11');assert.equal((await local.store.getQuota()).clockRollback,true);
  }finally{local.db.close();old.db.close();}}
});

test('restore unions known facts per month, is idempotent and refuses conflicting evidence or Pro schema',async()=>{
  const a=await fixture(),b=await fixture();try{
    for(let n=0;n<4;n++)await create(a);for(let n=0;n<3;n++)await create(b);const data=await readBackupData(b.adapter);
    await restore(a,data);await restore(a,data);assert.equal((await a.store.getQuota()).used,7);
    const before=await readBackupData(a.adapter),bad=structuredClone(data);bad.quota_events[0].period='2026-09';bad.quota_events[0].recorded_at='2026-09-01T00:00:00Z';
    await assert.rejects(restore(a,bad),/衝突/);assert.deepEqual(await readBackupData(a.adapter),before);
    b.db.exec('ALTER TABLE quota_state ADD COLUMN is_pro INTEGER');await assert.rejects(checkSchema(b.adapter,reference));assert.equal(freeOrderPermission(15,false).allowed,false);
  }finally{a.db.close();b.db.close();}
});

test('restore failure after replacement rolls back monthly facts, high-water, business rows and media pointer together',async()=>{
  const a=await fixture(),b=await fixture();try{await create(a);await create(b);b.clock.now='2026-11-01T00:00:00Z';await create(b);
    const before=await readBackupData(a.adapter),incoming=await readBackupData(b.adapter);await assert.rejects(restore(a,incoming,async()=>{throw Error('synthetic interruption');}));assert.deepEqual(await readBackupData(a.adapter),before);
  }finally{a.db.close();b.db.close();}
});

test('process termination during restore leaves the previous committed DB, quota and media root readable after reopening',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-quota-crash-')),path=join(dir,'live.sqlite'),a=await fixture(path),b=await fixture();
  try{await create(a);await create(b);await create(b);const before=await readBackupData(a.adapter),json=join(dir,'incoming.json');writeFileSync(json,JSON.stringify(await readBackupData(b.adapter)));
    const script=`import { DatabaseSync } from 'node:sqlite';import { readFileSync } from 'node:fs';import { replaceData } from ${JSON.stringify(new URL('../src/backup/data.ts',import.meta.url).href)};const db=new DatabaseSync(process.argv[1]);const p={exec:async s=>db.exec(s),run:async(s,a=[])=>db.prepare(s).run(...a),first:async(s,a=[])=>db.prepare(s).get(...a)??null,all:async(s,a=[])=>db.prepare(s).all(...a)};await replaceData(p,JSON.parse(readFileSync(process.argv[2],'utf8')),'00000000-0000-4000-8000-000000000001','crash-test',${JSON.stringify(DATE)},async()=>process.exit(42));`;
    const child=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script,path,json],{encoding:'utf8'});assert.equal(child.status,42,child.stderr);
    a.db.close();const reopened=new DatabaseSync(path);try{assert.deepEqual(await readBackupData(port(reopened)),before);}finally{reopened.close();}
  }finally{if(a.db.isOpen)a.db.close();b.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('monthly copy is bilingual; Free policy has no local Pro switch or backup purchase grant',async()=>{
  for(const locale of ['zh-HK','en']){await language.initialize({getItem:async()=>locale,setItem:async()=>{}},[]);
    assert.equal(tr`本月已建立 ${4} / ${15} 張訂單`,locale==='en'?'4 of 15 orders used this month':'本月已建立 4 / 15 張訂單');assert.match(trMessage(QUOTA_EXHAUSTED),locale==='en'?/next month/:/下月/);
  }
  assert.equal(FREE_LIMIT,15);assert.equal(freeOrderPermission(14,false).allowed,true);assert.equal(freeOrderPermission(15,false).allowed,false);assert.equal(freeOrderPermission(0,true).allowed,false);
  assert.doesNotMatch(readFileSync('src/data/monthlyQuota.ts','utf8'),/isPro|setItem|device-preferences/);
});
