import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { OrderStore } from '../src/data/store.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { blankInput } from '../src/domain/model.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { checkSchema, readBackupData, replaceData } from '../src/backup/data.ts';
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
