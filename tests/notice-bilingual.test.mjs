import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fixture, order, port, DATE } from './helpers/notice-bilingual.mjs';
import { buildNotice, firstNoticeLocale, noticeSourceKey, noticeTextBlocks, noticeFileLocale, noticeDate } from '../src/domain/notice.ts';
import { noticeCopy } from '../src/domain/noticeCopy.ts';
import { noticeRenderIdentity, initialNoticePreview, noticePreviewReducer } from '../src/domain/noticePreviewState.ts';
import { prepareNoticeExport } from '../src/domain/noticeExport.ts';
import { noticeCapturePlan, readNoticePngHeader } from '../src/domain/noticePng.ts';
import { pngCrc } from '../src/domain/noticePixels.ts';
import { toInput, FREE_LIMIT } from '../src/domain/model.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { language } from '../src/i18n/index.ts';
import { SCHEMA_VERSION } from '../src/data/migrations.ts';
import { OrderStore } from '../src/data/store.ts';
import { readBackupData, checkSchema, migrateInspected, validateData, replaceData, mediaReferences } from '../src/backup/data.ts';
import { writeArchive, inspectArchive, copyEntry } from '../src/backup/archive.ts';
import { parseManifest, verifySummary } from '../src/backup/manifest.ts';
import { verifyBackupMedia } from '../src/backup/media.ts';
const hash=b=>createHash('sha256').update(b).digest('hex');
const golden=JSON.parse(readFileSync(new URL('./fixtures/notice-legacy-zh.json',import.meta.url),'utf8'));
const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};
const rawRows=db=>Object.fromEntries(['orders','order_items','creation_ledger','status_history','app_state','payment_assets','payment_methods','order_payment_snapshots','notice_preferences','notice_files'].map(t=>[t,db.prepare(`SELECT * FROM ${t}`).all().map(row=>({...row}))]));
const record=(d,bytes=Buffer.from('synthetic-file'))=>{const id=randomUUID();return {id,orderId:d.orderId,shopId:d.shopId,orderRevision:d.orderRevision,preferencesRevision:d.preferencesRevision,template:d.template,locale:d.locale,relativePath:`payment-notices/${id}.png`,width:1080,height:16,bytes:bytes.length,sha256:hash(bytes),dataHash:hash(noticeSourceKey(d)),createdAt:DATE};};
async function select(f,id,template,locale,includeNote=false){const c=await f.store.getNoticeContext(id);await f.store.saveNoticePreferences(id,c.detail.order.revision,c.preferences.revision,{template,locale,includeNote,...(includeNote?{confirmedNote:c.detail.order.note}:{})});return buildNotice(await f.store.getNoticeContext(id));}
function png(width=1080,height=16){const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE((pngCrc(Buffer.concat([name,data]))^0xffffffff)>>>0,out.length-4);return out;};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((width*4+1)*height,255);for(let y=0;y<height;y++)rows[y*(width*4+1)]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}

test('two existing templates × two explicit locales translate every fixed label and keep customer text and cents',async()=>{
  const f=await fixture();try{const id=await order(f,{count:3,shipping:'custom',discount:'7.00'}),before=await f.store.getOrder(id);
    for(const template of ['editorial','soft'])for(const locale of ['zh-HK','en']){
      const doc=await select(f,id,template,locale,true),b=noticeTextBlocks(doc);assert.equal(doc.template,template);assert.equal(doc.locale,locale);
      assert.equal(b.title,locale==='en'?'Payment Notice':'付款通知 / Payment Notice');assert.equal(b.total,'HK$ 364.00');assert.equal(b.delivery,'HK$ 20.00');assert.equal(b.discount,'− HK$ 7.00');assert.equal(b.date,'2026/10/30 00:05 HKT');
      assert.equal(b.shop,'小滿手作');assert.equal(b.buyer,'合成買家 Buyer');assert.equal(b['item-0-name'],'第 1 件 合成商品 Product');assert.equal(b.note,'原文備註 Note');assert.equal(b.brand,'Made with OrderMori');
      if(locale==='en'){for(const [key,text] of Object.entries(b))if(!['shop','description','buyer','shipping','bank','payee','account','note'].includes(key)&&!key.endsWith('-name'))assert.doesNotMatch(text,/\p{Script=Han}/u,key);assert.match(b.legal,/Not a receipt or confirmation of payment/);assert.match(b.number,/^Order no\. OM-/);assert.equal(b.quantityLabel,'Qty');}
      assert.deepEqual(await f.store.getOrder(id),before);assert.equal((await f.store.getHome()).createdCount,1);
    }
    assert.equal(FREE_LIMIT,15);assert.deepEqual(Object.keys(noticeCopy.en).sort(),Object.keys(noticeCopy['zh-HK']).sort());
  }finally{f.db.close();}
});

test('v6/v7 fresh and historical schemas upgrade forward, preserve old source hashes/rows/triggers and default old files to zh-HK',async()=>{
  for(const version of [6,7])for(const legacy of [false,true]){const f=await fixture(version,legacy);try{
    const id=await order(f),doc=buildNotice(await f.store.getNoticeContext(id));assert.deepEqual(doc,golden.document);assert.deepEqual(noticeTextBlocks(doc),golden.blocks);assert.equal(hash(noticeSourceKey(doc)),golden.sha256);
    const old={...record(doc),preferencesRevision:0};delete old.locale;
    f.db.prepare('INSERT INTO notice_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(old.id,id,old.shopId,old.orderRevision,0,old.template,old.relativePath,1080,16,old.bytes,old.sha256,old.dataHash,DATE);
    const before=rawRows(f.db),triggers=f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
    assert.equal(await checkSchema(f.adapter,reference),version);f.db.exec('PRAGMA query_only=OFF');await f.store.initialize();await f.store.initialize();
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);assert.deepEqual(f.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name NOT LIKE 'quota_%' ORDER BY name").all(),triggers);
    assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'quota_%'").get().n,4);
    const after=rawRows(f.db);after.notice_files=after.notice_files.map(({locale,branding,...r})=>{assert.equal(locale,'zh-HK');assert.equal(branding,'Made with OrderMori');return r;});assert.deepEqual(after,before);
    const context=await f.store.getNoticeContext(id);assert.equal(context.preferences.locale,'zh-HK');assert.equal(hash(noticeSourceKey(buildNotice(context))),golden.sha256);
    assert.equal(noticeFileLocale((await f.store.listNoticeFiles(id))[0]),'zh-HK');assert.equal(await checkSchema(f.adapter,reference),SCHEMA_VERSION);
    assert.equal(firstNoticeLocale(context,await f.store.listNoticeFiles(id),'en'),'zh-HK');
  }finally{f.db.close();}}
});

test('v8 migration failure is atomic and retryable; no historical PNG row or database is reset',async()=>{
  const f=await fixture(7,true);try{await order(f);const before=rawRows(f.db),broken={...f.adapter,exec:async sql=>{await f.adapter.exec(sql);if(sql.includes('ALTER TABLE notice_files ADD COLUMN locale'))throw Error('synthetic v8 failure');}};
    await assert.rejects(new OrderStore(broken,randomUUID).initialize());assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,7);assert.deepEqual(rawRows(f.db),before);
    for(const [t,column]of [['notice_preferences','output_locale'],['notice_files','locale']])assert.ok(!f.db.prepare(`PRAGMA table_info(${t})`).all().some(c=>c.name===column));
    await f.store.initialize();assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
  }finally{f.db.close();}
});

test('first-use App language is only a default; saved preferences/legacy files and App language switches never rewrite notices',async()=>{
  const f=await fixture();try{const id=await order(f),c=await f.store.getNoticeContext(id);assert.equal(firstNoticeLocale(c,[],'en'),'en');assert.equal(firstNoticeLocale(c,[record(buildNotice(c))],'en'),'zh-HK');
    const doc=await select(f,id,'soft','en'),before=rawRows(f.db),blocks=noticeTextBlocks(doc);assert.equal(firstNoticeLocale(await f.store.getNoticeContext(id),[],'zh-HK'),'en');
    for(const value of ['en','zh-HK','system']){await language.initialize({getItem:async()=>value,setItem:async()=>{}},['en']);assert.deepEqual(buildNotice(await f.store.getNoticeContext(id)),doc);assert.deepEqual(noticeTextBlocks(doc),blocks);assert.deepEqual(rawRows(f.db),before);}
    assert.equal(noticeDate('2026-10-29T16:05:00Z'),noticeDate('2026-10-30T00:05:00+08:00'));
  }finally{f.db.close();}
});

test('bilingual file metadata and export hashes bind order, template and language; history survives failed captures/switches',async()=>{
  const f=await fixture();try{const id=await order(f),zh=buildNotice(await f.store.getNoticeContext(id)),old=record(zh);await f.store.recordNoticeFile(old,noticeSourceKey(zh));
    const en=await select(f,id,'editorial','en'),current=record(en);await f.store.recordNoticeFile(current,noticeSourceKey(en));
    const files=await f.store.listNoticeFiles(id);assert.equal(files.length,2);assert.deepEqual(files.find(x=>x.id===old.id),old);assert.notEqual(old.dataHash,current.dataHash);
    const verify=async file=>`file:///tmp/${file.id}.png`,digest=async s=>hash(s);await prepareNoticeExport(f.store,current,digest,verify);
    await assert.rejects(prepareNoticeExport(f.store,old,digest,verify),e=>e.code==='notice_export_stale');
    await assert.rejects(prepareNoticeExport(f.store,{...current,locale:'zh-HK'},digest,verify),e=>e.code==='notice_export_file');
    await assert.rejects(f.store.recordNoticeFile({...record(en),locale:'zh-HK'},noticeSourceKey(en)));
    await assert.rejects(f.store.recordNoticeFile(record(zh),noticeSourceKey(zh)));assert.equal((await f.store.listNoticeFiles(id)).length,2);
    assert.throws(()=>f.db.prepare("UPDATE notice_files SET locale='en' WHERE id=?").run(old.id),/immutable/);
    await assert.rejects(f.store.saveNoticePreferences(id,1,999,{template:'soft',locale:'en',includeNote:false}));assert.deepEqual(await f.store.listNoticeFiles(id),files);
    await assert.rejects(prepareNoticeExport(f.store,current,digest,async file=>{await select(f,id,'soft','zh-HK');return verify(file);}),e=>e.code==='notice_export_stale');
    assert.equal((await f.store.listNoticeFiles(id)).length,2);
  }finally{f.db.close();}
});

test('same-template late preview in the wrong language is rejected even when revision values are equal',()=>{
  const d={orderId:'test',orderRevision:1,preferencesRevision:1,template:'soft'},zh=noticeRenderIdentity({...d,locale:'zh-HK'}),en=noticeRenderIdentity({...d,locale:'en'});assert.notEqual(zh,en);
  const state=initialNoticePreview(en,'soft');assert.equal(noticePreviewReducer(state,{type:'ready',generation:1,image:{uri:'file:///tmp/old.png',width:1080,height:100,captureMs:1,template:'soft',identity:zh}}),state);
});

test('paid/refunded/cancelled/fulfilled orders cannot use a language change to generate or export requests',async()=>{
  for(const action of ['paid','refunded','cancelled','fulfilled']){const f=await fixture();try{const id=await order(f),doc=await select(f,id,'soft','en'),file=record(doc);await f.store.recordNoticeFile(file,noticeSourceKey(doc));
    if(action==='cancelled')await f.store.changeStatus(id,1,'cancel','synthetic');else{await f.store.changeStatus(id,1,'mark_paid','synthetic');if(action==='refunded')await f.store.changeStatus(id,2,'refund','synthetic');if(action==='fulfilled')await f.store.changeStatus(id,2,'fulfill','synthetic');}
    const c=await f.store.getNoticeContext(id);assert.throws(()=>buildNotice(c));await assert.rejects(f.store.saveNoticePreferences(id,c.detail.order.revision,c.preferences.revision,{template:'editorial',locale:'zh-HK',includeNote:false}));
    await assert.rejects(prepareNoticeExport(f.store,file,async s=>hash(s),async()=> 'file:///tmp/synthetic.png'));assert.equal((await f.store.listNoticeFiles(id)).length,1);
  }finally{f.db.close();}}
});

test('FPS/PayMe QR-only and text-plus-image keep original asset bytes/metadata and recipient in both locales',async()=>{
  for(const kind of ['fps','payme'])for(const withText of [false,true]){if(kind==='payme'&&withText)continue;const f=await fixture();try{const id=await order(f),bytes=png(1,1),assetId=randomUUID(),shop=await f.store.getShop();
    const asset={id:assetId,shopId:shop.id,kind,relativePath:`payment-assets/${assetId}.png`,mime:'image/png',bytes:bytes.length,sha256:hash(bytes),width:1,height:1};await f.store.registerPaymentAsset(asset);
    await f.store.savePaymentMethod(kind,{...emptyPayment(),qrAssetId:assetId,fpsType:'email',fpsValue:withText?'synthetic@example.invalid':'',confirmed:true});
    const method=(await f.store.getPaymentSettings()).methods.find(m=>m.kind===kind),detail=await f.store.getOrder(id);await f.store.updateOrder(id,detail.order.revision,{...toInput(detail),payment:snapshotOf(method)});
    const before=await f.store.getOrder(id),beforeHash=hash(bytes);
    for(const locale of ['zh-HK','en']){const doc=await select(f,id,'soft',locale),blocks=noticeTextBlocks(doc);assert.deepEqual(doc.qr,asset);assert.equal(hash(bytes),beforeHash);assert.equal(blocks.paymentValue,withText?'synthetic@example.invalid':undefined);assert.ok(blocks.qrLabel&&blocks.qrReminder);assert.deepEqual(await f.store.getOrder(id),before);}
  }finally{f.db.close();}}
});

test('20 items, 120-character mixed names, long consented note and large cents retain first/last/total/footer without truncation',async()=>{
  const f=await fixture();try{const note='香港 English '.repeat(40).slice(0,500),id=await order(f,{count:20,note,price:'1288888.88'}),detail=await f.store.getOrder(id),input=toInput(detail);
    input.items=input.items.map((item,i)=>({...item,name:`${String(i+1).padStart(2,'0')}-`+'長商品名 Product '.repeat(10).slice(0,117)}));await f.store.updateOrder(id,detail.order.revision,input);
    for(const template of ['editorial','soft'])for(const locale of ['zh-HK','en']){const doc=await select(f,id,template,locale,true),b=noticeTextBlocks(doc);assert.equal(doc.items.length,20);assert.ok(b['item-0-name'].startsWith('01-'));assert.ok(b['item-19-name'].startsWith('20-'));assert.equal(b.note,note);assert.equal(b.total,'HK$ 25,777,777.60');assert.ok(b.legal&&b.brand);assert.equal(noticeCapturePlan({width:360,height:3000},3).expectedWidth,1080);}
    assert.throws(()=>noticeCapturePlan({width:360,height:30000},3),/安全預算/);
    const source=readFileSync('src/ui/NoticePaper.tsx','utf8');assert.doesNotMatch(source,/numberOfLines|ellipsizeMode|FlatList|SectionList|resizeMode="cover"/);assert.match(source,/resizeMode="contain"/);
  }finally{f.db.close();}
});

const byteSource=b=>({size:b.length,read:async(at,n)=>new Uint8Array(b.subarray(at,at+n))});
async function packageBackup(f,path,media,version){
  const snapshot=path+'.snapshot';execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]);d=sqlite3.connect(sys.argv[2]);s.backup(d);d.close();s.close()',path,snapshot]);
  const home=f.db.prepare('SELECT created_count AS createdCount FROM app_state').get(),summary={orders:1,items:1,media:Object.keys(media).length,createdCount:1,profileId:'synthetic-profile',schemaVersion:version,...(version>=7?{products:(await f.store.listProducts()).length}:{})};assert.equal(home.createdCount,1);
  if(version>=9){const q=await f.store.getQuota();summary.quotaPeriod=q.period;summary.quotaUsed=q.used;}
  const files=[['data.sqlite',readFileSync(snapshot)],...Object.entries(media).map(([p,b])=>['media/'+p,b])];
  const manifest={format:'OrderMori',version:1,createdAt:DATE,schemaVersion:version,summary,files:files.map(([path,b])=>({path,size:b.length,sha256:hash(b)}))},chunks=[];
  await writeArchive([['manifest.json',Buffer.from(JSON.stringify(manifest))],...files].map(([path,b])=>({path,source:byteSource(b)})),{write:async b=>{chunks.push(Buffer.from(b));}});
  const archive=Buffer.concat(chunks),entries=await inspectArchive(byteSource(archive)),contents={};for(const e of entries){const chunks=[];await copyEntry(byteSource(archive),e,{write:async b=>{chunks.push(Buffer.from(b));}});contents[e.path]=Buffer.concat(chunks);}
  const parsed=parseManifest(contents['manifest.json'].toString(),entries);for(const item of parsed.files)assert.equal(hash(contents[item.path]),item.sha256);return {parsed,contents};
}

test('actual v6/v7/v8/v9 ZIP backups migrate only on staging; restore bilingual file languages/media, historical hashes and quota safely',async()=>{
  for(const version of [6,7,8,9]){const dir=mkdtempSync(join(tmpdir(),'ordermori-bilingual-backup-')),path=join(dir,'live.sqlite'),f=await fixture(version,true,path),target=await fixture();try{
    const id=await order(f),zh=buildNotice(await f.store.getNoticeContext(id)),bytes=png(),old=record(zh,bytes),media={[old.relativePath]:bytes};
    if(version>=7)await f.store.saveProduct({name:'舊備份常用商品',price:'88.00'});
    if(version<8)f.db.prepare('INSERT INTO notice_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(old.id,id,old.shopId,old.orderRevision,old.preferencesRevision,old.template,old.relativePath,old.width,old.height,old.bytes,old.sha256,old.dataHash,DATE);
    else {await f.store.recordNoticeFile(old,noticeSourceKey(zh));const en=await select(f,id,'soft','en'),current=record(en,bytes);await f.store.recordNoticeFile(current,noticeSourceKey(en));media[current.relativePath]=bytes;}
    const before=rawRows(f.db),{parsed,contents}=await packageBackup(f,path,media,version),stagePath=join(dir,'staging.sqlite');writeFileSync(stagePath,contents['data.sqlite']);const stage=new DatabaseSync(stagePath);
    try{assert.equal(await checkSchema(port(stage),reference),version);await migrateInspected(port(stage));const data=await readBackupData(port(stage));verifySummary(parsed,validateData(data));assert.equal(data.notice_files.length,version>=8?2:1);assert.equal(data.notice_files.find(r=>r.id===old.id).data_hash,old.dataHash);assert.equal(data.notice_files.find(r=>r.id===old.id).locale,'zh-HK');
      const refs=mediaReferences(data),generation=randomUUID(),mediaDir=join(dir,generation);for(const r of refs){const p=join(mediaDir,r.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,contents['media/'+r.path]);}
      await verifyBackupMedia(refs,{size:async p=>readFileSync(join(mediaDir,p)).length,hash:async p=>hash(readFileSync(join(mediaDir,p))),header:async p=>readFileSync(join(mediaDir,p)).subarray(0,24),dimensions:async p=>readNoticePngHeader(readFileSync(join(mediaDir,p)).subarray(0,24))});
      await order(target);await order(target);const live=await readBackupData(target.adapter);await assert.rejects(target.store.maintenance(db=>replaceData(db,data,generation,randomUUID(),DATE,async()=>{throw Error('synthetic restore failure');})));assert.deepEqual(await readBackupData(target.adapter),live);
      await target.store.maintenance(db=>replaceData(db,data,generation,randomUUID(),DATE));assert.equal((await target.store.getHome()).createdCount,2);assert.equal((await target.store.getNoticeContext(id)).preferences.locale,version>=8?'en':'zh-HK');
      assert.equal((await target.store.listProducts()).length,version>=7?1:0);
      const restored=await target.store.listNoticeFiles(id);assert.equal(restored.length,version>=8?2:1);assert.equal(restored.find(r=>r.id===old.id).dataHash,old.dataHash);for(const r of restored)assert.equal(hash(readFileSync(join(mediaDir,r.relativePath))),r.sha256);
      if(version<8)assert.equal(hash(noticeSourceKey(buildNotice(await target.store.getNoticeContext(id)))),golden.sha256);
      assert.deepEqual(rawRows(f.db),before);assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,version);
    }finally{stage.close();}
  }finally{f.db.close();target.db.close();rmSync(dir,{recursive:true,force:true});}}
});

test('unknown schema, invalid output language and immutable file metadata remain rejected',async()=>{
  const f=await fixture();try{const id=await order(f),doc=await select(f,id,'editorial','en'),file=record(doc);await f.store.recordNoticeFile(file,noticeSourceKey(doc));const data=await readBackupData(f.adapter);
    assert.throws(()=>validateData({...data,notice_files:data.notice_files.map(r=>({...r,locale:'fr'}))}),/語言無效/);
    assert.throws(()=>f.db.prepare("UPDATE notice_preferences SET output_locale='fr' WHERE order_id=?").run(id),/CHECK/);
    f.db.exec('ALTER TABLE notice_files ADD COLUMN untrusted_pro INTEGER');await assert.rejects(checkSchema(f.adapter,reference));
  }finally{f.db.close();}
});


test('selected notice locale persists after reopening SQLite and locale-less older callers preserve English',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ordermori-notice-locale-reopen-')),path=join(dir,'live.sqlite'),f=await fixture(8,false,path);let reopened;
  try{const id=await order(f),doc=await select(f,id,'soft','en');await f.store.saveNoticePreferences(id,1,doc.preferencesRevision,{template:'editorial',includeNote:false});
    const before=await f.store.getNoticeContext(id);assert.equal(before.preferences.locale,'en');assert.equal(f.db.prepare('SELECT locale,output_locale FROM notice_preferences').get().locale,'zh-HK');
    f.db.close();reopened=new DatabaseSync(path);const store=new OrderStore(port(reopened),randomUUID);await store.initialize();assert.deepEqual((await store.getNoticeContext(id)).preferences,before.preferences);
  }finally{reopened?.close();if(f.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('an existing Soft Korean Chinese preference and consent snapshot keep their pre-v8 source hash',async()=>{
  const f=await fixture(7,true);try{const id=await order(f);await f.store.saveNoticePreferences(id,1,0,{template:'soft',includeNote:true,confirmedNote:'原文備註 Note'});
    const legacy={...golden.document,template:'soft',preferencesRevision:1,customerNote:'原文備註 Note'},before=await f.store.getNoticeContext(id);assert.equal(noticeSourceKey(buildNotice(before)),JSON.stringify(legacy));
    const file={...record(legacy),dataHash:hash(JSON.stringify(legacy))};f.db.prepare('INSERT INTO notice_files VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(file.id,id,file.shopId,1,1,'soft',file.relativePath,1080,16,file.bytes,file.sha256,file.dataHash,DATE);
    await f.store.initialize();const after=await f.store.getNoticeContext(id);assert.deepEqual(after.preferences,before.preferences);assert.equal(noticeSourceKey(buildNotice(after)),JSON.stringify(legacy));
    const registered=(await f.store.listNoticeFiles(id))[0];assert.equal(registered.dataHash,file.dataHash);await prepareNoticeExport(f.store,registered,async s=>hash(s),async()=>`file:///tmp/${file.id}.png`);
  }finally{f.db.close();}
});
