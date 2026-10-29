import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderStore } from '../src/data/store.ts';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/data/migrations.ts';
import { buildNotice, noticeSourceKey, noticeTextBlocks } from '../src/domain/notice.ts';
import { noticePreviewReducer, initialNoticePreview, canSaveNoticePreview, noticeRenderIdentity, withNoticeCaptureDeadline, withNoticeCaptureSlot } from '../src/domain/noticePreviewState.ts';
import { noticeDiagnostic, noticeFailure } from '../src/domain/noticeDiagnostics.ts';
import { noticeSchemaDiagnostic } from '../src/data/noticeCompatibility.ts';

const date = '2026-01-01T00:00:00.000Z';
function port(db) { return { exec: async (s) => { db.exec(s); }, run: async (s,p=[]) => db.prepare(s).run(...p), first: async (s,p=[]) => db.prepare(s).get(...p) ?? null, all: async (s,p=[]) => db.prepare(s).all(...p) }; }
function legacyV3(missingColumn, includeNote = false, path = ':memory:') {
  const db = new DatabaseSync(path);
  for (const migration of MIGRATIONS.filter((m) => m.version <= 3)) {
    const sql = missingColumn && migration.version === 3 ? migration.sql.replace('note_snapshot TEXT NOT NULL, ', '') : migration.sql; db.exec(sql);
  }
  db.exec('PRAGMA user_version=3');
  db.exec("INSERT INTO shops VALUES('synthetic-shop','合成店名','Far','2026-01-01'); INSERT INTO app_state(id,profile_id,active_shop_id,created_count,order_number_seq) VALUES(1,'synthetic-profile','synthetic-shop',1,1)");
  db.prepare(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
    VALUES('synthetic-order','synthetic-shop','OM-000001','synthetic-request','@synthetic','合成店名','Far','active','unpaid','pending','sf_collect',11700,0,0,11700,'合成未公開備註',?,?)`).run(date,date);
  db.exec("INSERT INTO order_items VALUES('synthetic-item','synthetic-order','synthetic-shop',0,'合成商品',3,3900,11700)");
  const payment = { version: 1, methodId: 'synthetic-method', shopId: 'synthetic-shop', kind: 'fps', revision: 1,
    fpsType: 'email', fpsValue: 'synthetic@example.invalid', bankName: '', accountName: '', accountNumber: '', qrAssetId: null, confirmed: true, confirmedAt: date };
  db.prepare('INSERT INTO payment_methods VALUES(?,?,?,?,NULL,1,?)').run(payment.methodId,payment.shopId,'fps',JSON.stringify(payment),date);
  db.prepare('INSERT INTO order_payment_snapshots VALUES(?,?,?,?,NULL)').run('synthetic-order',payment.shopId,'fps',JSON.stringify(payment));
  const id = '00000000-0000-4000-8000-000000000001';
  db.prepare('INSERT INTO notice_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'synthetic-order','synthetic-shop',1,0,'editorial',`payment-notices/${id}.png`,1080,3517,10000,'a'.repeat(64),'b'.repeat(64),date);
  if (includeNote) {
    if (missingColumn) db.exec("INSERT INTO notice_preferences(order_id,shop_id,template,locale,include_note,revision) VALUES('synthetic-order','synthetic-shop','editorial','zh-HK',1,1)");
    else db.exec("INSERT INTO notice_preferences VALUES('synthetic-order','synthetic-shop','editorial','zh-HK',1,'合成未公開備註',1)");
  }
  const store = new OrderStore(port(db), () => 'synthetic-id', () => date); return { db, store };
}
const tables = ['orders','order_items','payment_methods','order_payment_snapshots','notice_files','app_state'];
const rows = (db) => Object.fromEntries(tables.map((t) => [t,db.prepare(`SELECT * FROM ${t}`).all()]));

test('reproduces v3: default black preview works, first template write fails without note_snapshot; v4 repairs forwards', async () => {
  const { db, store } = legacyV3(true);
  try {
    const original = rows(db); assert.equal(buildNotice(await store.getNoticeContext('synthetic-order')).template,'editorial');
    await assert.rejects(store.saveNoticePreferences('synthetic-order',1,0,{ template:'soft',includeNote:false }), (e) => e.stage === 'settings-write' && e.diagnosticCode === 'schema_note_snapshot_missing' && e.schema.schemaVersion === 3);
    assert.deepEqual(rows(db),original);
    await store.initialize(); assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
    assert.ok(db.prepare('PRAGMA table_info(notice_preferences)').all().some((c) => c.name === 'note_snapshot'));
    for (const template of ['soft','editorial','soft','editorial']) {
      const context = await store.getNoticeContext('synthetic-order'); await store.saveNoticePreferences('synthetic-order',1,context.preferences.revision,{ template,includeNote:false });
      assert.equal(buildNotice(await store.getNoticeContext('synthetic-order')).template,template);
    }
    assert.deepEqual(rows(db),original); assert.equal((await store.getHome()).createdCount,1);
  } finally { db.close(); }
});

test('modern v3 and existing legacy consent are preserved; compatibility never publishes current internal notes', async () => {
  for (const missing of [true,false]) {
    const { db, store } = legacyV3(missing,true);
    try {
      const before = rows(db), previous = db.prepare('SELECT * FROM notice_preferences').get();
      await store.initialize(); await store.initialize(); assert.deepEqual(rows(db),before);
      const next = db.prepare('SELECT * FROM notice_preferences').get();
      assert.equal(next.include_note,previous.include_note); assert.equal(next.revision,previous.revision);
      assert.equal(next.note_snapshot,missing ? '' : previous.note_snapshot);
      const context = await store.getNoticeContext('synthetic-order');
      if (missing) assert.throws(() => buildNotice(context), /重新確認/); else assert.equal(buildNotice(context).customerNote,previous.note_snapshot);
    } finally { db.close(); }
  }
});

test('v4 repair failure rolls back and never resets v3 data or historical PNG metadata', async () => {
  const { db } = legacyV3(true);
  try {
    const before=rows(db), adapter=port(db), exec=adapter.exec;
    adapter.exec=async(s) => { if(s.startsWith('ALTER TABLE notice_preferences')) { db.exec('CREATE TABLE partial_repair(id TEXT)'); throw Error('synthetic IO failure'); } return exec(s); };
    const store=new OrderStore(adapter,()=> 'unused'); await assert.rejects(store.initialize());
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,3); assert.deepEqual(rows(db),before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='partial_repair'").get().n,0);
  } finally { db.close(); }
});

const image=(identity,template,generation=1) => ({ uri:`file:///tmp/synthetic-${generation}.png`,width:1080,height:2400,captureMs:10,identity,template });
test('black -> soft -> black never accepts the previous template result or error', () => {
  let state=initialNoticePreview('black-1','editorial');
  state=noticePreviewReducer(state,{type:'ready',generation:1,image:image('black-1','editorial')});
  state=noticePreviewReducer(state,{type:'displayed',generation:1,identity:'black-1'}); assert.equal(canSaveNoticePreview(state,'black-1','editorial'),true);
  state=initialNoticePreview('soft-2','soft');
  const soft=state;
  assert.equal(noticePreviewReducer(state,{type:'ready',generation:1,image:image('black-1','editorial')}),soft);
  assert.equal(noticePreviewReducer(state,{type:'error',generation:1,identity:'black-1',error:'old failure'}),soft);
  assert.equal(canSaveNoticePreview(state,'black-1','editorial'),false);
  state=noticePreviewReducer(state,{type:'ready',generation:1,image:image('soft-2','soft')});
  state=noticePreviewReducer(state,{type:'displayed',generation:1,identity:'soft-2'}); assert.equal(canSaveNoticePreview(state,'soft-2','soft'),true);
  state=initialNoticePreview('black-3','editorial'); assert.equal(noticePreviewReducer(state,{type:'ready',generation:1,image:image('soft-2','soft')}),state);
});

test('failed capture retries with a new generation; stale completion cannot enable save or replace current PNG', () => {
  let state=initialNoticePreview('source','soft'); state=noticePreviewReducer(state,{type:'error',generation:1,identity:'source',error:'capture failed'});
  assert.equal(state.phase,'error'); assert.equal(state.image,null);
  state=noticePreviewReducer(state,{type:'retry'}); assert.equal(state.generation,2); assert.equal(state.phase,'loading');
  assert.equal(noticePreviewReducer(state,{type:'ready',generation:1,image:image('source','soft')}),state);
  state=noticePreviewReducer(state,{type:'ready',generation:2,image:image('source','soft',2)}); assert.equal(canSaveNoticePreview(state,'source','soft'),false);
  state=noticePreviewReducer(state,{type:'displayed',generation:2,identity:'source'}); assert.equal(canSaveNoticePreview(state,'source','soft'),true);
  const ready=state; assert.equal(noticePreviewReducer(state,{type:'error',generation:1,identity:'source',error:'late'}),ready);
  state=noticePreviewReducer(state,{type:'saved',generation:2,identity:'source'}); assert.equal(canSaveNoticePreview(state,'source','soft'),false); assert.equal(state.image.uri,ready.image.uri);
});

test('capture queue recovers after rejection and timed-out late captures are disposed', async () => {
  const events=[]; let unblock;
  const gate=new Promise((resolve) => { unblock=resolve; });
  const first=withNoticeCaptureSlot(async() => { events.push('A'); await gate; throw Error('synthetic failure'); });
  const second=withNoticeCaptureSlot(async() => { events.push('B'); return 'done'; });
  await Promise.resolve(); assert.deepEqual(events,['A']); unblock(); await assert.rejects(first); assert.equal(await second,'done'); assert.deepEqual(events,['A','B']);
  let late; const disposed=[]; const timed=withNoticeCaptureDeadline(() => new Promise((resolve) => { late=resolve; }),async(value) => { disposed.push(value); },1);
  await assert.rejects(timed,/超時/); late('synthetic-late-file'); await Promise.resolve(); await Promise.resolve(); assert.deepEqual(disposed,['synthetic-late-file']);
  assert.equal(await withNoticeCaptureSlot(async() => 'next'),'next');
});

test('diagnostics expose only stage/template/safe code and never raw customer, bank, URI or source data', () => {
  const secret='SYNTHETIC_PRIVATE_PAYEE_AND_BUYER';
  for (const stage of ['settings','template-render','layout','asset','capture','png-validation','temp-file','preview-read','save-file']) {
    const diagnostic=noticeDiagnostic(stage,'soft',new Error(secret)); assert.deepEqual(diagnostic,{stage,template:'soft',code:'native_error'}); assert.ok(!JSON.stringify(diagnostic).includes(secret));
  }
  assert.equal(noticeDiagnostic('settings','soft',new Error('table notice_preferences has no column named note_snapshot')).code,'schema_note_snapshot_missing');
  const oldDev=globalThis.__DEV__,oldWarn=console.warn,logs=[]; globalThis.__DEV__=true; console.warn=(...args)=>logs.push(args);
  try { const failure=noticeFailure('capture','soft',new Error(secret)); noticeFailure('preview-read','soft',failure); assert.equal(logs.length,1); assert.ok(!JSON.stringify(logs).includes(secret)); }
  finally { globalThis.__DEV__=oldDev; console.warn=oldWarn; }
});

test('description Far is preserved from the snapshot and zero adjustments do not bloat the table', async () => {
  const { db,store }=legacyV3(false);
  try {
    await store.initialize(); const document=buildNotice(await store.getNoticeContext('synthetic-order'));
    for (const template of ['editorial','soft']) { const copy=noticeTextBlocks({...document,template}); assert.equal(copy.description,'Far'); assert.equal(copy.discount,undefined); assert.equal(copy.delivery,undefined); assert.equal(copy.total,'HK$ 117.00'); assert.equal(copy.brand,'Made with OrderMori'); }
    assert.match(noticeTextBlocks(document).shipping,/另付予順豐/);
    assert.equal(noticeRenderIdentity(document),'synthetic-order:1:0:editorial');
    const before=noticeSourceKey(document); noticeTextBlocks({...document,template:'soft'}); assert.equal(noticeSourceKey(document),before);
  } finally { db.close(); }
});

test('disk SQLite: incomplete/full v3/v4 -> v5 commits, closes/reopens, and binds all six settings parameters', async () => {
  const directory=mkdtempSync(join(tmpdir(),'ordermori-settings-upgrade-'));
  try {
    for (const {missing,version} of [{missing:true,version:3},{missing:false,version:3},{missing:true,version:4},{missing:false,version:4}]) {
      const path=join(directory,`${missing ? 'early' : 'complete'}-v${version}.sqlite`);
      const pngPath=`${path}.historical.png`, priorBytes=Buffer.from('synthetic pre-existing PNG file bytes'); writeFileSync(pngPath,priorBytes);
      let {db}=legacyV3(missing,false,path);
      db.exec(`PRAGMA user_version=${version}`);
      const before=rows(db); db.close(); db=new DatabaseSync(path);
      try {
        const adapter=port(db), exec=adapter.exec, run=adapter.run, operations=[], bindings=[];
        adapter.exec=async(sql) => { operations.push(sql); return exec(sql); };
        adapter.run=async(sql,params=[]) => {
          if(sql.startsWith('INSERT INTO notice_preferences')) { bindings.push([...params]); assert.equal((sql.match(/\?/g)||[]).length,6); }
          return run(sql,params);
        };
        const store=new OrderStore(adapter,()=> 'unused'); await store.initialize();
        const change=operations.findIndex((sql)=>sql.startsWith('ALTER TABLE notice_preferences'));
        const record=operations.indexOf('PRAGMA user_version=5'); const commit=operations.lastIndexOf('COMMIT');
        assert.ok(record>=0 && commit>record); assert.equal(change>=0,missing); if(missing) assert.ok(change<record);
        assert.equal(operations.includes('PRAGMA user_version=4'),version===3);
        for(const template of ['soft','editorial','soft']) {
          const current=await store.getNoticeContext('synthetic-order');
          await store.saveNoticePreferences('synthetic-order',1,current.preferences.revision,{template,includeNote:false});
          assert.equal((await store.getNoticeContext('synthetic-order')).preferences.template,template);
        }
        assert.deepEqual(bindings.map((p)=>[p.length,p[2],p[3],p[4],p[5]]),[[6,'soft',0,'',1],[6,'editorial',0,'',2],[6,'soft',0,'',3]]);
        assert.deepEqual(rows(db),before);
      } finally { db.close(); }
      db=new DatabaseSync(path);
      try {
        const store=new OrderStore(port(db),()=> 'unused'); await store.initialize();
        assert.deepEqual(await noticeSchemaDiagnostic(port(db)),{schemaVersion:5,missingColumns:[]});
        const current=await store.getNoticeContext('synthetic-order'); assert.equal(current.preferences.template,'soft'); assert.equal(current.preferences.revision,3);
        await store.saveNoticePreferences('synthetic-order',1,3,{template:'editorial',includeNote:false}); assert.deepEqual(rows(db),before);
        assert.deepEqual(readFileSync(pngPath),priorBytes);
      } finally { db.close(); }
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('unknown partial v3/v4 missing a base field fails schema-check without rebuilding or changing its version', async () => {
  for(const version of [3,4]) {
    const {db}=legacyV3(true); const before=rows(db);
    try {
      db.exec('ALTER TABLE notice_preferences RENAME COLUMN revision TO legacy_revision');
      db.exec(`PRAGMA user_version=${version}`);
      const store=new OrderStore(port(db),()=> 'unused');
      await assert.rejects(store.initialize(),(e)=>e.stage==='schema-check' && e.diagnosticCode==='notice_schema');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
      assert.ok(db.prepare('PRAGMA table_info(notice_preferences)').all().some((c)=>c.name==='legacy_revision'));
      assert.deepEqual(rows(db),before);
    } finally { db.close(); }
  }
});

test('real SQLite settings constraints, read, BEGIN and COMMIT failures carry their own stage and recover', async () => {
  for(const fault of ['read','not-null','check','foreign-key','begin','commit']) {
    const {db}=legacyV3(false);
    try {
      const adapter=port(db), first=adapter.first, run=adapter.run, exec=adapter.exec;
      const store=new OrderStore(adapter,()=> 'unused'); await store.initialize(); const before=rows(db);
      let injected=false;
      adapter.first=async(sql,params) => { if(fault==='read' && sql.includes('SELECT * FROM notice_preferences')) return db.prepare('SELECT * FROM synthetic_missing_table').get(); return first(sql,params); };
      adapter.run=async(sql,params) => {
        if(sql.startsWith('INSERT INTO notice_preferences')) {
          params=[...params]; if(fault==='not-null') params[4]=null; if(fault==='check') params[2]='unsupported'; if(fault==='foreign-key') params[1]='synthetic-other-shop';
        }
        return run(sql,params);
      };
      adapter.exec=async(sql) => { if(fault==='commit' && sql==='COMMIT' && !injected) { injected=true; throw Error('synthetic commit failure'); } return exec(sql); };
      if(fault==='begin') db.exec('BEGIN');
      const expected={read:['settings-read','schema_table_missing'],'not-null':['settings-write','sqlite_not_null'],check:['settings-write','sqlite_check'],'foreign-key':['settings-write','sqlite_foreign_key'],begin:['settings-transaction','sqlite_transaction'],commit:['settings-commit','native_error']}[fault];
      await assert.rejects(store.saveNoticePreferences('synthetic-order',1,0,{template:'soft',includeNote:false}),
        (e)=>e.stage===expected[0] && e.diagnosticCode===expected[1]);
      if(fault==='begin') db.exec('ROLLBACK');
      assert.deepEqual(rows(db),before);
      adapter.first=first; adapter.run=run; adapter.exec=exec;
      for(const template of ['soft','editorial']) { const current=await store.getNoticeContext('synthetic-order'); await store.saveNoticePreferences('synthetic-order',1,current.preferences.revision,{template,includeNote:false}); }
      assert.deepEqual(rows(db),before);
    } finally { db.close(); }
  }
});

test('Expo-shaped wrapped SQLite errors expose a safe code and number, never raw native messages or values', () => {
  const privateText='SYNTHETIC_PRIVATE_VALUE_DO_NOT_LOG';
  const cases=[['NOT NULL constraint failed: notice_preferences.note_snapshot','sqlite_not_null'],['CHECK constraint failed: template IN (...)','sqlite_check'],['FOREIGN KEY constraint failed','sqlite_foreign_key'],['UNIQUE constraint failed: notice_preferences.order_id','sqlite_unique'],['foreign key mismatch','schema_foreign_key_mismatch']];
  for(const [reason,code] of cases) {
    const error={message:'NativeStatement.runAsync rejected',cause:{message:`Error code 19: ${reason} ${privateText}`}};
    const failure=noticeFailure('settings-write','soft',error,{schemaVersion:4,missingColumns:[]});
    const result=noticeDiagnostic('settings-write','soft',failure);
    assert.deepEqual(result,{stage:'settings-write',template:'soft',code,sqliteCode:19,schemaVersion:4,missingColumns:[]});
    assert.ok(!JSON.stringify(result).includes(privateText)); assert.ok(!failure.message.includes(privateText));
  }
});

test('reported device shape: user_version 4 missing note_snapshot repairs forwards and preserves all prior rows', async () => {
  const {db,store}=legacyV3(true); db.exec('PRAGMA user_version=4');
  try {
    const before=rows(db);
    await assert.rejects(store.saveNoticePreferences('synthetic-order',1,0,{template:'soft',includeNote:false}),
      (e)=>e.stage==='settings-write' && e.diagnosticCode==='schema_note_snapshot_missing' && e.sqliteCode===1 && e.schema.schemaVersion===4);
    await store.initialize();
    assert.equal(db.prepare('PRAGMA table_info(notice_preferences)').all().some((c)=>c.name==='note_snapshot'),true);
    for(const template of ['soft','editorial','soft']) {
      const context=await store.getNoticeContext('synthetic-order');
      await store.saveNoticePreferences('synthetic-order',1,context.preferences.revision,{template,includeNote:false});
      assert.equal((await store.getNoticeContext('synthetic-order')).preferences.template,template);
    }
    assert.deepEqual(rows(db),before);
  } finally { db.close(); }
});

test('v5 ALTER failure rolls back v4 data and version, and a later retry repairs without rebuilding', async () => {
  const {db}=legacyV3(true,true); db.exec('PRAGMA user_version=4');
  try {
    const before=rows(db),adapter=port(db),exec=adapter.exec;
    adapter.exec=async(sql)=>{if(sql.startsWith('ALTER TABLE notice_preferences')) { db.exec('CREATE TABLE synthetic_partial_v5(id TEXT)'); throw Error('synthetic migration failure'); } return exec(sql);};
    const store=new OrderStore(adapter,()=> 'unused');
    await assert.rejects(store.initialize(),(e)=>e.stage==='migration');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,4); assert.deepEqual(rows(db),before);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='synthetic_partial_v5'").get().n,0);
    adapter.exec=exec; await store.initialize();
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,5); assert.deepEqual(rows(db),before);
    const context=await store.getNoticeContext('synthetic-order');
    assert.equal(context.preferences.includeNote,true); assert.equal(context.preferences.noteSnapshot,'');
    assert.throws(()=>buildNotice(context),/重新確認/);
    await store.saveNoticePreferences('synthetic-order',1,context.preferences.revision,{template:'soft',includeNote:false});
    assert.equal(buildNotice(await store.getNoticeContext('synthetic-order')).template,'soft');
  } finally {db.close();}
});
