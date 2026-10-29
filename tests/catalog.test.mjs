import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { OrderStore } from '../src/data/store.ts';
import { blankInput, evaluate } from '../src/domain/model.ts';
import { normalizeProduct, appendCatalogProduct, productSlots } from '../src/domain/catalog.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { buildNotice, noticeSourceKey } from '../src/domain/notice.ts';
import { SCHEMA_VERSION } from '../src/data/migrations.ts';
import { checkSchema, createSchema, migrateInspected, readBackupData, replaceData, validateData } from '../src/backup/data.ts';
import { writeArchive, inspectArchive, copyEntry } from '../src/backup/archive.ts';
import { parseManifest, verifySummary } from '../src/backup/manifest.ts';

const date='2026-10-29T00:00:00.000Z';
const adapter=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
const reference=async()=>{const db=new DatabaseSync(':memory:');return{db:adapter(db),close:async()=>db.close()};};
const source=b=>({size:b.length,read:async(at,n)=>new Uint8Array(b.subarray(at,at+n))});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(path=':memory:') {const db=new DatabaseSync(path),store=new OrderStore(adapter(db),randomUUID,()=>date);await store.initialize();await store.saveShop('合成測試店','');return {db,store,close:()=>db.close()};}
const protectedRows=db=>Object.fromEntries(['shops','app_state','orders','order_items','drafts','creation_ledger','status_history','payment_methods','order_payment_snapshots','notice_preferences','notice_files'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));

test('catalog CRUD persists integer cents, supports literal search and never consumes Free usage',async()=>{
  const f=await fixture();try{
    const before=protectedRows(f.db),id=await f.store.saveProduct({name:'  香氣蠟燭 Candle 100%_  ',price:'0.29'}),other=await f.store.saveProduct({name:'手作髮圈',price:'58.00'});
    const p=await f.store.getProduct(id);assert.equal(p.name,'香氣蠟燭 Candle 100%_');assert.equal(p.unit_price_cents,29);assert.equal(p.revision,1);assert.equal(p.created_at,date);
    assert.equal(f.db.prepare('SELECT typeof(unit_price_cents) AS t FROM catalog_products WHERE id=?').get(id).t,'integer');
    for(const query of ['candle','蠟燭','100%_'])assert.deepEqual((await f.store.listProducts(query)).map(p=>p.id),[id]);
    assert.deepEqual(await f.store.listProducts("' OR 1=1 --"),[]);
    await f.store.saveProduct({name:'新名稱',price:'12.34'},{id,revision:1});const edited=await f.store.getProduct(id);assert.equal(edited.unit_price_cents,1234);assert.equal(edited.revision,2);
    await f.store.deleteProduct(id,2);await assert.rejects(f.store.getProduct(id),e=>e.code==='product_missing');assert.equal((await f.store.listProducts()).length,1);assert.equal((await f.store.getProduct(other)).unit_price_cents,5800);
    assert.deepEqual(protectedRows(f.db),before);
  }finally{f.close();}
});

test('empty/long/control names and invalid/overflow prices reject; zero-priced and 120-codepoint names remain valid',async()=>{
  const f=await fixture();try{
    for(const input of [{name:' ',price:'1'},{name:'長'.repeat(121),price:'1'},{name:'a\nb',price:'1'},...['','-1','1.001','1e2','NaN','Infinity','90071992547410.00'].map(price=>({name:'合成',price}))])await assert.rejects(f.store.saveProduct(input),e=>e.code==='product_validation');
    assert.deepEqual(await f.store.listProducts(),[]);assert.deepEqual(normalizeProduct({name:'💡'.repeat(120),price:'0.00'}),{name:'💡'.repeat(120),cents:0});
  }finally{f.close();}
});

test('duplicate names need explicit confirmation; edits/deletes/selections reject stale revisions',async()=>{
  const f=await fixture();try{
    const id=await f.store.saveProduct({name:'Candle',price:'10.00'});await assert.rejects(f.store.saveProduct({name:'candle',price:'20.00'}),e=>e.code==='product_duplicate');
    const second=await f.store.saveProduct({name:'candle',price:'20.00'},undefined,true);assert.notEqual(id,second);assert.equal((await f.store.getProduct(id)).unit_price_cents,1000);
    await f.store.saveProduct({name:'Candle 改版',price:'30.00'},{id,revision:1});
    await assert.rejects(f.store.getProduct(id,1),e=>e.code==='conflict');await assert.rejects(f.store.saveProduct({name:'不應覆蓋',price:'1.00'},{id,revision:1}),e=>e.code==='conflict');await assert.rejects(f.store.deleteProduct(id,1),e=>e.code==='conflict');
    assert.equal((await f.store.getProduct(id)).name,'Candle 改版');
  }finally{f.close();}
});

test('catalog access is scoped to the active shop for list/read/update/delete',async()=>{
  const f=await fixture();try{
    f.db.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('other-shop','其他合成店','',date);
    f.db.prepare('INSERT INTO catalog_products(id,shop_id,name,unit_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('other-product','other-shop','其他商品',100,date,date);
    assert.deepEqual(await f.store.listProducts(),[]);await assert.rejects(f.store.getProduct('other-product'));await assert.rejects(f.store.saveProduct({name:'不應寫入',price:'1'},{id:'other-product',revision:1}));await assert.rejects(f.store.deleteProduct('other-product',1));
    assert.equal(f.db.prepare('SELECT name FROM catalog_products WHERE id=?').get('other-product').name,'其他商品');
  }finally{f.close();}
});

test('selection copies independent fields, supports repeat selections and preserves partial manual input',async()=>{
  const f=await fixture();try{
    const id=await f.store.saveProduct({name:'常用商品',price:'39.00'}),p=await f.store.getProduct(id),blank=blankInput('pristine');
    let input=appendCatalogProduct(blank,p,'row-1');assert.equal(input.items.length,1);assert.equal(input.items[0].quantity,'1');assert.equal(productSlots(input),19);assert.deepEqual(Object.keys(input.items[0]).sort(),['id','name','price','quantity']);
    input.items[0].price='40.00';input.items[0].quantity='2';input=appendCatalogProduct(input,p,'row-2');assert.equal(input.items.length,2);assert.notEqual(input.items[0].id,input.items[1].id);assert.equal(input.items[0].price,'40.00');assert.equal(input.items[1].price,'39.00');assert.equal(evaluate({...input,buyer:'合成'}).total,11900);
    const partial={...blankInput('manual'),buyer:'保留買家',note:'保留備註'};partial.items[0].name='未完成手填';partial.items[0].quantity='2';
    const added=appendCatalogProduct(partial,p,'row-3');assert.deepEqual(added.items[0],partial.items[0]);assert.equal(added.buyer,partial.buyer);assert.equal(added.note,partial.note);
    assert.equal(blank.items[0].name,'');assert.equal(p.unit_price_cents,3900);
    for(let i=2;i<20;i++)input=appendCatalogProduct(input,p,`row-${i+1}`);
    assert.equal(productSlots(input),0);assert.throws(()=>appendCatalogProduct(input,p,'row-21'));assert.equal(input.items.length,20);
  }finally{f.close();}
});

test('price changes/deletion never rewrite saved orders, draft snapshots, payment snapshots, locked amounts or recorded PNGs',async()=>{
  const f=await fixture();try{
    const id=await f.store.saveProduct({name:'原商品',price:'117.00'}),product=await f.store.getProduct(id);
    await f.store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC',accountNumber:'NOT REAL',confirmed:true});
    const method=(await f.store.getPaymentSettings()).methods[0],draft=await f.store.openDraft();
    const input={...appendCatalogProduct(draft.input,product,randomUUID()),buyer:'合成買家',payment:snapshotOf(method)};
    const orderId=await f.store.createOrder(draft.requestId,input);await f.store.saveNoticePreferences(orderId,1,0,{template:'editorial',includeNote:false});
    const doc=buildNotice(await f.store.getNoticeContext(orderId)),fileId=randomUUID();
    await f.store.recordNoticeFile({id:fileId,orderId,shopId:doc.shopId,orderRevision:1,preferencesRevision:1,template:'editorial',relativePath:`payment-notices/${fileId}.png`,width:1080,height:2000,bytes:1000,sha256:'a'.repeat(64),dataHash:sha(noticeSourceKey(doc)),createdAt:date},noticeSourceKey(doc));
    await f.store.changeStatus(orderId,1,'mark_paid','合成付款');
    const nextDraft=await f.store.openDraft();await f.store.saveDraft(nextDraft.requestId,1,appendCatalogProduct(nextDraft.input,product,randomUUID()));
    const before=protectedRows(f.db);
    await f.store.saveProduct({name:'新商品名',price:'199.00'},{id,revision:1});await f.store.deleteProduct(id,2);
    assert.deepEqual(protectedRows(f.db),before);assert.equal((await f.store.getOrder(orderId)).items[0].unit_price_cents,11700);
    const oldItem=(await f.store.getOrder(orderId)).items[0];await f.store.saveProduct({name:oldItem.name_snapshot,price:'117.00'});
    assert.deepEqual(protectedRows(f.db),before); // Manual save from history creates catalog data only.
  }finally{f.close();}
});

test('v6 -> v7 on fresh and original historical trigger variants is forward-only and idempotent',async()=>{
  for(const legacy of [false,true]){
    const db=new DatabaseSync(':memory:');try{
      const p=adapter(db);await createSchema(p,6,legacy,false,legacy);
      db.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('shop','合成舊店','',date);db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('profile','shop');
      const old=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
      assert.equal(await checkSchema(p,reference),6);await p.exec('PRAGMA query_only=OFF');const store=new OrderStore(p,randomUUID);await store.initialize();await store.initialize();
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);assert.deepEqual(await store.listProducts(),[]);
      assert.deepEqual(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'catalog_products%' ORDER BY name").all(),old);
      assert.equal(await checkSchema(p,reference),7);
    }finally{db.close();}
  }
});

async function packAndRead(path,data,legacy) {
  const bytes=readFileSync(path),manifest={format:'OrderMori',version:1,createdAt:date,schemaVersion:legacy?.schemaVersion ?? SCHEMA_VERSION,summary:legacy?.summary ?? validateData(data),files:[{path:'data.sqlite',size:bytes.length,sha256:sha(bytes)}]},chunks=[];
  await writeArchive([{path:'manifest.json',source:source(Buffer.from(JSON.stringify(manifest)))},{path:'data.sqlite',source:source(bytes)}],{write:async b=>{chunks.push(Buffer.from(b));}});
  const packed=Buffer.concat(chunks),entries=await inspectArchive(source(packed)),files={};for(const entry of entries){const out=[];await copyEntry(source(packed),entry,{write:async b=>{out.push(Buffer.from(b));}});files[entry.path]=Buffer.concat(out);}
  const parsed=parseManifest(files['manifest.json'].toString(),entries);assert.equal(sha(files['data.sqlite']),parsed.files[0].sha256);if(data)verifySummary(parsed,validateData(data));return {files,parsed};
}

test('v7 catalog participates in actual WAL snapshot/archive/import/restore and rollback',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-catalog-backup-')),f=await fixture(join(dir,'live.sqlite')),target=await fixture();try{
    const first=await f.store.saveProduct({name:'合成 Candle',price:'29.99'});await f.store.saveProduct({name:'髮圈',price:'58.00'});
    const data=await readBackupData(adapter(f.db));assert.equal(validateData(data).products,2);
    execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()',join(dir,'live.sqlite'),join(dir,'snapshot.sqlite')]);
    const {files,parsed}=await packAndRead(join(dir,'snapshot.sqlite'),data);assert.equal(parsed.version,1);assert.equal(parsed.schemaVersion,7);assert.equal(parsed.summary.products,2);
    writeFileSync(join(dir,'import.sqlite'),files['data.sqlite']);const copy=new DatabaseSync(join(dir,'import.sqlite'));
    try{
      const p=adapter(copy);assert.equal(await checkSchema(p,reference),7);await migrateInspected(p);const imported=await readBackupData(p);
      const before=await readBackupData(adapter(target.db));await assert.rejects(target.store.maintenance(db=>replaceData(db,imported,randomUUID(),randomUUID(),date,async()=>{throw Error('synthetic failure');})));assert.deepEqual(await readBackupData(adapter(target.db)),before);
      await target.store.maintenance(db=>replaceData(db,imported,randomUUID(),randomUUID(),date));assert.deepEqual(await target.store.listProducts(),await f.store.listProducts());assert.equal((await target.store.getProduct(first)).unit_price_cents,2999);
    }finally{copy.close();}
  }finally{f.close();target.close();rmSync(dir,{recursive:true,force:true});}
});

test('v6 format-1 backup without catalog migrates only on its copy, restores empty catalog and preserves quota',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-catalog-v6-')),target=await fixture(),old=new DatabaseSync(join(dir,'v6.sqlite'));try{
    const p=adapter(old);await createSchema(p,6,true,false,true);
    old.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('old-shop','合成 v6 舊店','',date);old.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('old-profile','old-shop');
    assert.equal(await checkSchema(p,reference),6);
    execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()',join(dir,'v6.sqlite'),join(dir,'snapshot.sqlite')]);
    const summary={orders:0,items:0,media:0,createdCount:0,profileId:'old-profile',schemaVersion:6};
    const {files,parsed}=await packAndRead(join(dir,'snapshot.sqlite'),null,{schemaVersion:6,summary});
    assert.equal(parsed.version,1);assert.equal(parsed.summary.products,undefined);
    const rawPath=join(dir,'raw-import.sqlite'),stagedPath=join(dir,'staging-copy.sqlite');writeFileSync(rawPath,files['data.sqlite']);writeFileSync(stagedPath,files['data.sqlite']);
    const stage=new DatabaseSync(stagedPath);try{
      assert.equal(await checkSchema(adapter(stage),reference),6);await migrateInspected(adapter(stage));const data=await readBackupData(adapter(stage));verifySummary(parsed,validateData(data));assert.deepEqual(data.catalog_products,[]);
      assert.equal(old.prepare('PRAGMA user_version').get().user_version,6);assert.equal(old.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='catalog_products'").get().n,0);assert.deepEqual(readFileSync(rawPath),files['data.sqlite']);
      await target.store.saveProduct({name:'還原後應移除',price:'1.00'});
      const d=await target.store.openDraft();await target.store.createOrder(d.requestId,{...d.input,buyer:'合成',items:[{id:randomUUID(),name:'合成商品',price:'1',quantity:'1'}]});
      await target.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),date));assert.deepEqual(await target.store.listProducts(),[]);assert.equal((await readBackupData(adapter(target.db))).app_state[0].created_count,1);
      await target.store.saveProduct({name:'還原後仍可新增',price:'2.00'});assert.equal((await target.store.listProducts()).length,1);
    }finally{stage.close();}
  }finally{old.close();target.close();rmSync(dir,{recursive:true,force:true});}
});

test('new backup summary and catalog schema/data are validated; no arbitrary columns or executable SQL gain trust',async()=>{
  const f=await fixture();try{
    const summary=validateData(await readBackupData(adapter(f.db))),m={format:'OrderMori',version:1,createdAt:date,schemaVersion:7,summary:{...summary,products:99},files:[]};assert.throws(()=>verifySummary(m,summary));
    f.db.exec('ALTER TABLE catalog_products ADD COLUMN pro INTEGER DEFAULT 1');await assert.rejects(checkSchema(adapter(f.db),reference));
  }finally{f.close();}
  const b=await fixture();try{b.db.exec('CREATE TRIGGER injected_product AFTER INSERT ON catalog_products BEGIN DELETE FROM orders; END');await assert.rejects(checkSchema(adapter(b.db),reference));}finally{b.close();}
  const c=await fixture();try{c.db.exec('PRAGMA ignore_check_constraints=ON');c.db.prepare('INSERT INTO catalog_products(id,shop_id,name,unit_price_cents,revision,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(randomUUID(),(await c.store.getShop()).id,'非法',1.5,date,date);await assert.rejects(readBackupData(adapter(c.db)));}finally{c.close();}
});

test('library remains manageable when Free quota is exhausted; manual entry still creates independent orders',async()=>{
  const f=await fixture();try{
    for(let i=0;i<10;i++){const d=await f.store.openDraft();await f.store.createOrder(d.requestId,{...d.input,buyer:'合成',items:[{id:randomUUID(),name:'手動商品',price:'1.00',quantity:'1'}]});}
    const before=protectedRows(f.db),id=await f.store.saveProduct({name:'額度已滿仍可維護',price:'2.00'});await f.store.saveProduct({name:'已修改',price:'3.00'},{id,revision:1});await f.store.deleteProduct(id,2);assert.deepEqual(protectedRows(f.db),before);
    assert.equal((await f.store.getHome()).createdCount,10);assert.equal((await f.store.getHome()).orders.length,10);
  }finally{f.close();}
});

test('catalog values persist across closing/reopening a real SQLite file and repeated initialization',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-catalog-reopen-')),path=join(dir,'data.sqlite');let db;
  try{
    const f=await fixture(path);const id=await f.store.saveProduct({name:'重啟保留',price:'19.29'});await f.store.saveProduct({name:'重啟後名稱',price:'20.01'},{id,revision:1});const before=await f.store.listProducts();f.close();
    db=new DatabaseSync(path);const store=new OrderStore(adapter(db),randomUUID);await store.initialize();await store.initialize();assert.deepEqual(await store.listProducts(),before);assert.equal((await store.getProduct(id)).unit_price_cents,2001);assert.equal((await store.getHome()).createdCount,0);
  }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});

test('v7 migration failure rolls back its new table/index and keeps the v6 business database retryable',async()=>{
  const db=new DatabaseSync(':memory:');try{
    const p=adapter(db);await createSchema(p,6,true,false,true);
    db.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('shop','合成舊店','',date);db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('profile','shop');
    const before=db.prepare('SELECT * FROM app_state').all();const broken={...p,exec:async sql=>{await p.exec(sql);if(sql.includes('CREATE TABLE catalog_products'))throw Error('synthetic v7 write failure');}};
    await assert.rejects(new OrderStore(broken,randomUUID).initialize());assert.equal(db.prepare('PRAGMA user_version').get().user_version,6);assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'catalog_products%'").get().n,0);assert.deepEqual(db.prepare('SELECT * FROM app_state').all(),before);
    await new OrderStore(p,randomUUID).initialize();assert.equal(db.prepare('PRAGMA user_version').get().user_version,7);
  }finally{db.close();}
});
