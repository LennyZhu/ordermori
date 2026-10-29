import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { OrderStore } from '../src/data/store.ts';
import { blankInput, toInput } from '../src/domain/model.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { buildNotice, noticeSourceKey } from '../src/domain/notice.ts';
import { NoticeExporter, prepareNoticeExport } from '../src/domain/noticeExport.ts';
import { readNoticePngHeader, hasPngEnd } from '../src/domain/noticePng.ts';
import { pngCrc } from '../src/domain/noticePixels.ts';

const date='2026-01-01T00:00:00.000Z';
const sha=(s)=>createHash('sha256').update(s).digest('hex');
const adapter=(db)=>({exec:async(s)=>db.exec(s),run:async(s,p=[])=>db.prepare(s).run(...p),first:async(s,p=[])=>db.prepare(s).get(...p)??null,all:async(s,p=[])=>db.prepare(s).all(...p)});
const protectedRows=(db)=>Object.fromEntries(['shops','orders','order_items','app_state','order_payment_snapshots','payment_methods','notice_preferences','notice_files','status_history'].map((t)=>[t,db.prepare(`SELECT * FROM ${t}`).all()]));
function syntheticPng(height) {
  const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE((pngCrc(Buffer.concat([name,data]))^0xffffffff)>>>0,out.length-4);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(1080);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const raw=Buffer.alloc((1080*4+1)*height,255);
  for(let y=0;y<height;y++){const start=y*(1080*4+1);raw[start]=0;raw[start+1]=raw[start+2]=raw[start+3]=32;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(template='editorial',path=':memory:',directory=mkdtempSync(join(tmpdir(),'ordermori-export-')),height=80,corruptDataHash=false) {
  const db=new DatabaseSync(path);let n=0;
  const store=new OrderStore(adapter(db),()=>`synthetic-${++n}`,()=>date);await store.initialize();
  await store.saveShop('合成店舖','合成資料');
  await store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC ONLY',accountNumber:'NOT-A-REAL-ACCOUNT',confirmed:true});
  const method=(await store.getPaymentSettings()).methods[0],draft=await store.openDraft();
  const orderId=await store.createOrder(draft.requestId,{...blankInput('synthetic-item'),buyer:'@synthetic',items:[{id:'synthetic-item',name:'合成商品',price:'117.00',quantity:'1'}],payment:snapshotOf(method)});
  await store.saveNoticePreferences(orderId,1,0,{template,includeNote:false});
  const document=buildNotice(await store.getNoticeContext(orderId)),id='00000000-0000-4000-8000-000000000001';
  const bytes=syntheticPng(height),filePath=join(directory,`${id}.png`);writeFileSync(filePath,bytes);
  const file={id,orderId,shopId:document.shopId,orderRevision:document.orderRevision,preferencesRevision:document.preferencesRevision,template,
    relativePath:`payment-notices/${id}.png`,width:1080,height,bytes:bytes.length,sha256:sha(bytes),dataHash:corruptDataHash ? 'f'.repeat(64) : sha(noticeSourceKey(document)),createdAt:date};
  await store.recordNoticeFile(file,noticeSourceKey(document));
  // Native verification uses verifyNoticeFile + Image decoder. The injected
  // verifier checks real local fixture bytes without pretending to test iOS.
  const verify=async(record)=>{const data=readFileSync(filePath),size=readNoticePngHeader(data);if(!hasPngEnd(data.subarray(-12))||sha(data)!==record.sha256||data.length!==record.bytes||size.width!==record.width||size.height!==record.height)throw Error('synthetic corrupt PNG');return pathToFileURL(filePath).href;};
  const prepare=(record)=>prepareNoticeExport(store,record,async(s)=>sha(s),verify);
  const events=[];
  const ports={prepare,sharingAvailable:async()=>true,share:async(uri)=>{events.push(['share',uri]);},photoPermission:async(request)=>{events.push(['permission',request]);return {granted:true,canAskAgain:true};},savePhoto:async(uri)=>{events.push(['photos',uri]);}};
  return {db,store,file,bytes,filePath,directory,ports,events,prepare,cleanup(){db.close();rmSync(directory,{recursive:true,force:true});}};
}

test('both templates share/save the exact original PNG URI with no changes to SQLite or source bytes',async()=>{
  for(const template of ['editorial','soft']) {
    const f=await fixture(template);try{
      const before=protectedRows(f.db),exporter=new NoticeExporter();
      assert.equal(await exporter.run('share',f.file,f.ports),'分享面板已關閉；未確認是否傳送。');
      assert.equal(await exporter.run('photos',f.file,f.ports),'已儲存至相簿');
      assert.deepEqual(f.events,[['share',pathToFileURL(f.filePath).href],['permission',false],['photos',pathToFileURL(f.filePath).href]]);
      assert.deepEqual(protectedRows(f.db),before);assert.deepEqual(readFileSync(f.filePath),f.bytes);
    }finally{f.cleanup();}
  }
});

test('share sheet cancellation/resolution is neutral; unavailable and failed sheets preserve files and allow retry',async()=>{
  const f=await fixture();try{
    const before=protectedRows(f.db),exporter=new NoticeExporter();
    await assert.rejects(exporter.run('share',f.file,{...f.ports,sharingAvailable:async()=>false}),e=>e.code==='notice_share_unavailable');
    await assert.rejects(exporter.run('share',f.file,{...f.ports,share:async()=>{throw Error('synthetic share failure');}}),e=>e.code==='notice_export_failed');
    const result=await exporter.run('share',f.file,f.ports);assert.doesNotMatch(result,/已傳送|已付款|已送達/);
    assert.deepEqual(protectedRows(f.db),before);assert.deepEqual(readFileSync(f.filePath),f.bytes);
  }finally{f.cleanup();}
});

test('photos ask only when needed; denial, permanent denial and save failure do not delete or mutate anything',async()=>{
  const f=await fixture();try{
    const before=protectedRows(f.db),exporter=new NoticeExporter();let requests=[];
    const permission=async(request)=>{requests.push(request);return {granted:false,canAskAgain:true};};
    await assert.rejects(exporter.run('photos',f.file,{...f.ports,photoPermission:permission}),e=>e.code==='notice_photos_permission');assert.deepEqual(requests,[false,true]);
    requests=[];
    await assert.rejects(exporter.run('photos',f.file,{...f.ports,photoPermission:async(request)=>{requests.push(request);return {granted:false,canAskAgain:false};}}),e=>e.code==='notice_photos_permission');assert.deepEqual(requests,[false]);
    const allowed=[];await exporter.run('photos',f.file,{...f.ports,photoPermission:async(request)=>{allowed.push(request);return {granted:request,canAskAgain:true};}});assert.deepEqual(allowed,[false,true]);
    await assert.rejects(exporter.run('photos',f.file,{...f.ports,savePhoto:async()=>{throw Error('synthetic disk full');}}),e=>e.code==='notice_export_failed');
    assert.deepEqual(protectedRows(f.db),before);assert.deepEqual(readFileSync(f.filePath),f.bytes);
  }finally{f.cleanup();}
});

test('double taps and cross-screen share/photos calls have one shared gate until native completion',async()=>{
  const f=await fixture();try{
    const exporter=new NoticeExporter();let release,entered;const reached=new Promise(resolve=>{entered=resolve;});
    const first=exporter.run('share',f.file,{...f.ports,share:async()=>{entered();await new Promise(resolve=>{release=resolve;});}});await reached;
    await assert.rejects(exporter.run('share',f.file,f.ports),e=>e.code==='notice_export_busy');
    await assert.rejects(exporter.run('photos',f.file,f.ports),e=>e.code==='notice_export_busy');
    release();await first;await exporter.run('share',f.file,f.ports);assert.equal(f.events.filter(e=>e[0]==='share').length,1);
  }finally{f.cleanup();}
});

test('paid, refunded, cancelled and fulfilled orders cannot export their historical PNG through either operation',async()=>{
  for(const state of ['paid','refunded','cancelled','fulfilled']) {
    const f=await fixture();try{
      if(state==='cancelled')await f.store.changeStatus(f.file.orderId,1,'cancel','合成取消');
      else{await f.store.changeStatus(f.file.orderId,1,'mark_paid','合成付款');if(state==='refunded')await f.store.changeStatus(f.file.orderId,2,'refund','合成退款');if(state==='fulfilled')await f.store.changeStatus(f.file.orderId,2,'fulfill','合成履約');}
      const before=protectedRows(f.db),exporter=new NoticeExporter();
      for(const kind of ['share','photos'])await assert.rejects(exporter.run(kind,f.file,f.ports));
      assert.equal(f.events.length,0);assert.deepEqual(protectedRows(f.db),before);assert.deepEqual(readFileSync(f.filePath),f.bytes);
    }finally{f.cleanup();}
  }
});

test('ownership, current template, snapshot hash and saved amount mismatches block export',async()=>{
  for(const change of ['ownership','template','hash','amount']) {
    const f=await fixture('editorial',':memory:',undefined,80,change==='hash');try{
      let requested=f.file;
      if(change==='ownership')requested={...f.file,shopId:'synthetic-other-shop'};
      if(change==='template')await f.store.saveNoticePreferences(f.file.orderId,1,1,{template:'soft',includeNote:false});
      if(change==='amount'){
        const detail=await f.store.getOrder(f.file.orderId),input=toInput(detail);input.items[0].price='118.00';
        await f.store.updateOrder(f.file.orderId,1,{...input,payment:detail.payment});
      }
      const before=protectedRows(f.db);await assert.rejects(new NoticeExporter().run('share',requested,f.ports));assert.deepEqual(protectedRows(f.db),before);assert.equal(f.events.length,0);
    }finally{f.cleanup();}
  }
});

test('missing/corrupt local PNG fails before permissions or sharing, and retry works after repairing only the fixture',async()=>{
  const f=await fixture();try{
    const before=protectedRows(f.db),exporter=new NoticeExporter();unlinkSync(f.filePath);
    await assert.rejects(exporter.run('share',f.file,f.ports));
    writeFileSync(f.filePath,Buffer.from('synthetic corrupt PNG'));await assert.rejects(exporter.run('photos',f.file,f.ports));assert.equal(f.events.length,0);
    writeFileSync(f.filePath,f.bytes);await exporter.run('share',f.file,f.ports);assert.deepEqual(protectedRows(f.db),before);
  }finally{f.cleanup();}
});

test('changing current shop/bank settings never backfills the saved order snapshot used for export',async()=>{
  const f=await fixture();try{
    await f.store.saveShop('另一個合成店名','新合成資料');
    await f.store.savePaymentMethod('bank',{...emptyPayment(),bankName:'新的合成銀行',accountName:'OTHER SYNTHETIC',accountNumber:'NOT-REAL-UPDATED',confirmed:true});
    const before=protectedRows(f.db);await new NoticeExporter().run('share',f.file,f.ports);
    const document=buildNotice(await f.store.getNoticeContext(f.file.orderId));assert.equal(document.shopName,'合成店舖');assert.equal(document.payment.bankName,'合成銀行');
    assert.deepEqual(protectedRows(f.db),before);assert.deepEqual(readFileSync(f.filePath),f.bytes);
  }finally{f.cleanup();}
});

test('state changed during file checking or the permission prompt is rechecked before native handoff',async()=>{
  for(const phase of ['verify','permission']) {
    const f=await fixture();try{
      let mutated=false;
      const mutate=async()=>{if(!mutated){mutated=true;await f.store.changeStatus(f.file.orderId,1,'mark_paid','合成付款');}};
      const ports={...f.ports};
      if(phase==='permission')ports.photoPermission=async()=>{await mutate();return {granted:true,canAskAgain:true};};
      if(phase==='verify')ports.prepare=record=>prepareNoticeExport(f.store,record,async(s)=>sha(s),async()=>{await mutate();return pathToFileURL(f.filePath).href;});
      await assert.rejects(new NoticeExporter().run(phase==='permission'?'photos':'share',f.file,ports));
      assert.equal(f.events.length,0);assert.equal((await f.store.listNoticeFiles(f.file.orderId)).length,1);assert.deepEqual(readFileSync(f.filePath),f.bytes);
    }finally{f.cleanup();}
  }
});

test('leaving the page during permission request aborts before saving and keeps native assets independent',async()=>{
  const f=await fixture();try{
    let active=true;const before=protectedRows(f.db),ports={...f.ports,photoPermission:async()=>{active=false;return {granted:true,canAskAgain:true};}};
    await assert.rejects(new NoticeExporter().run('photos',f.file,ports,()=>active),e=>e.code==='notice_export_inactive');assert.equal(f.events.length,0);assert.deepEqual(protectedRows(f.db),before);
  }finally{f.cleanup();}
});

test('after reopening real SQLite, a tall saved PNG can be exported without rendering or changing its bytes',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'ordermori-export-reopen-')),dbPath=join(directory,'test.sqlite');
  const f=await fixture('soft',dbPath,directory,2000);f.db.close();let db;
  try{
    db=new DatabaseSync(dbPath);const store=new OrderStore(adapter(db),()=> 'unused',()=>date);await store.initialize();
    const record=(await store.listNoticeFiles(f.file.orderId))[0],before=protectedRows(db);
    const prepare=file=>prepareNoticeExport(store,file,async(s)=>sha(s),async(stored)=>{assert.equal(sha(readFileSync(f.filePath)),stored.sha256);return pathToFileURL(f.filePath).href;});
    await new NoticeExporter().run('share',record,{...f.ports,prepare});assert.deepEqual(readFileSync(f.filePath),f.bytes);assert.deepEqual(protectedRows(db),before);
    const photoCopy=join(directory,'synthetic-photos-copy.png');await new NoticeExporter().run('photos',record,{...f.ports,prepare,savePhoto:async()=>writeFileSync(photoCopy,readFileSync(f.filePath))});
    unlinkSync(f.filePath);await store.removeNoticeFile(record.orderId,record.id);assert.deepEqual(readFileSync(photoCopy),f.bytes);
  }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});

test('config extends existing signing and plugins, keeps outgoing-only sharing and a Traditional Chinese add-photos description',()=>{
  const config={ios:{appleTeamId:'SYNTHETIC_TEAM',infoPlist:{ExistingSetting:true}},plugins:['synthetic-existing-plugin']};
  const result=createRequire(import.meta.url)('../app.config.js')({config});
  assert.deepEqual(result.ios,config.ios);assert.equal(result.plugins[0],config.plugins[0]);
  const sharing=result.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-sharing')[1];assert.equal(sharing.ios.enabled,false);
  const media=result.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-media-library')[1];assert.match(media.savePhotosPermission,/付款通知圖片儲存至相簿/);assert.deepEqual(media.granularPermissions,[]);assert.equal(media.isAccessMediaLocationEnabled,false);
});

test('first grant waits for foreground, rechecks eligibility and saves once without a second tap',async()=>{
  for(const change of [false,true]) {
    const f=await fixture();try{
      const {waitForPermissionForeground}=await import('../src/domain/permissionForeground.ts');
      let state='active',listener,waitStarted;const waiting=new Promise(resolve=>{waitStarted=resolve;});
      let removed=0,checks=0;const requests=[];const exporter=new NoticeExporter();
      const ports={...f.ports,
        prepare:async(file)=>{checks++;return f.prepare(file);},
        photoPermission:async(request)=>{requests.push(request);if(request)state='inactive';return {granted:request,canAskAgain:true};},
        afterPhotoPermissionGranted:()=>{const result=waitForPermissionForeground({current:()=>state,subscribe:fn=>{listener=fn;return ()=>{removed++;};}},()=>true);waitStarted();return result;},
      };
      const pending=exporter.run('photos',f.file,ports,()=>state==='active');await waiting;
      assert.equal(checks,1);assert.equal(f.events.length,0);
      await assert.rejects(exporter.run('photos',f.file,ports),e=>e.code==='notice_export_busy');
      if(change)await f.store.changeStatus(f.file.orderId,1,'mark_paid','合成付款');
      state='active';listener(state);
      if(change)await assert.rejects(pending,e=>Boolean(e.code));
      else assert.equal(await pending,'已儲存至相簿');
      assert.deepEqual(requests,[false,true]);assert.equal(checks,2);assert.equal(removed,1);
      assert.equal(f.events.filter(e=>e[0]==='photos').length,change?0:1);
    }finally{f.cleanup();}
  }
});

test('already authorized and denied photos never wait for a permission foreground transition',async()=>{
  const f=await fixture();try{
    for(const granted of [true,false]){
      const requests=[];const ports={...f.ports,photoPermission:async(request)=>{requests.push(request);return {granted,canAskAgain:true};},afterPhotoPermissionGranted:async()=>assert.fail('no granted prompt')};
      if(granted)await new NoticeExporter().run('photos',f.file,ports);
      else await assert.rejects(new NoticeExporter().run('photos',f.file,ports),e=>e.code==='notice_photos_permission');
      assert.deepEqual(requests,granted?[false]:[false,true]);
    }
    assert.equal(f.events.filter(e=>e[0]==='photos').length,1);
  }finally{f.cleanup();}
});

test('permission foreground waiter cleans up for active, background, unmounted and timeout paths',async()=>{
  const {waitForPermissionForeground}=await import('../src/domain/permissionForeground.ts');
  for(const scenario of ['active','background','unmounted','timeout']){
    let removed=0;
    const events={current:()=>scenario==='active'?'active':scenario==='background'?'background':'inactive',subscribe:()=>()=>{removed++;}};
    const result=waitForPermissionForeground(events,()=>scenario!=='unmounted',1);
    if(scenario==='active')await result;
    else await assert.rejects(result,e=>e.code==='notice_export_inactive');
    assert.equal(removed,1);
  }
});
