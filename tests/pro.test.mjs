import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { ProEntitlementService, PRO_PRODUCT_ID, proMessage } from '../src/domain/pro.ts';
import { checkedStoreProof } from '../src/domain/storeProof.ts';
import { OrderStore } from '../src/data/store.ts';
import { buildNotice, noticeSourceKey, noticeTextBlocks } from '../src/domain/notice.ts';
import { noticeRenderIdentity } from '../src/domain/noticePreviewState.ts';
import { prepareNoticeExport } from '../src/domain/noticeExport.ts';
import { readBackupData, replaceData, validateData, checkSchema, migrateInspected } from '../src/backup/data.ts';
import { language, tr } from '../src/i18n/index.ts';
import { fixture, order, port, DATE } from './helpers/notice-bilingual.mjs';
import { DatabaseSync } from 'node:sqlite';
const proof={transactionId:'test-verified-001',productId:PRO_PRODUCT_ID,environment:'Sandbox'};
const product={id:PRO_PRODUCT_ID,displayPrice:'¥800',title:'OrderMori Pro',currency:'JPY'};
function storekit() {
  const state={evidence:{kind:'absent'},product,purchaseCalls:0,finished:[],syncs:0,changed:()=>{},purchase:async()=> 'submitted'};
  const service=new ProEntitlementService({connect:async changed=>{state.changed=changed;},product:async()=>{if(state.productError)throw state.productError;return state.product;},
    evidence:async()=>{if(state.error)throw state.error;return state.evidence;},purchase:async()=>{state.purchaseCalls++;return state.purchase();},
    sync:async()=>{state.syncs++;if(state.syncError)throw state.syncError;},finish:async p=>{if(state.finishError)throw state.finishError;state.finished.push(p.transactionId);}});
  return {state,service};
}
const error=code=>Object.assign(new Error('Synthetic technical error'),{code});
const own=async f=>{f.state.evidence={kind:'active',proof};await f.service.refresh();};
const input=()=>({buyer:'SYNTHETIC',items:[{id:randomUUID(),name:'合成 Product',price:'9.99',quantity:'1'}],shipping:'included',shippingFee:'0',discount:'',note:''});
const create=async store=>{const d=await store.openDraft();return store.createOrder(d.requestId,input());};
const digest=s=>createHash('sha256').update(s).digest('hex');
const fileFor=d=>({id:randomUUID(),orderId:d.orderId,shopId:d.shopId,orderRevision:d.orderRevision,preferencesRevision:d.preferencesRevision,template:d.template,locale:d.locale,branding:d.branding,relativePath:'placeholder',width:1080,height:2902,bytes:100,sha256:'a'.repeat(64),dataHash:digest(noticeSourceKey(d)),createdAt:DATE});

test('StoreKit product price remains localized, missing/failed product disables purchase, and no callback grants Pro',async()=>{
  const f=storekit();await f.service.start();assert.equal(f.service.getSnapshot().status,'free');
  await f.service.loadProduct();assert.equal(f.service.getSnapshot().product.displayPrice,'¥800');assert.equal(f.service.getSnapshot().product.currency,'JPY');
  await f.service.purchase();assert.equal(f.service.current().unlimited,false);assert.equal(f.service.getSnapshot().message,proMessage.verification);
  f.state.product=null;await f.service.loadProduct();await f.service.purchase();assert.equal(f.state.purchaseCalls,1);assert.equal(f.service.getSnapshot().product,null);
  f.state.productError=error('network-error');await f.service.loadProduct();assert.equal(f.service.getSnapshot().tone,'error');
});

test('verified purchase unlocks once, duplicate events/requests finish once, and owned users cannot purchase again',async()=>{
  const f=storekit();let release;f.state.purchase=()=>new Promise(resolve=>{release=()=>{f.state.evidence={kind:'active',proof};resolve('submitted');};});
  await f.service.loadProduct();const first=f.service.purchase();await new Promise(resolve=>setImmediate(resolve));await f.service.purchase();assert.equal(f.state.purchaseCalls,1);release();await first;
  assert.equal(f.service.getSnapshot().message,proMessage.unlocked);assert.equal(f.service.current().unlimited,true);
  const grant=f.service.current();await Promise.all([f.service.refresh(),f.service.refresh()]);await f.service.purchase();assert.equal(f.state.purchaseCalls,1);assert.deepEqual(f.state.finished,[proof.transactionId]);f.service.assertCurrent(grant);
});

test('cancel, pending, deferred, payment failure and offline error have distinct feedback without unlocking',async()=>{
  for(const [code,message,tone] of [['user-cancelled',proMessage.cancelled,'info'],['pending',proMessage.pending,'info'],['deferred-payment',proMessage.pending,'info'],['purchase-error',proMessage.failed,'error'],['network-error',proMessage.unavailable,'error']]){
    const f=storekit();f.state.purchase=async()=>{throw error(code);};await f.service.purchase();assert.equal(f.service.current().unlimited,false);assert.equal(f.service.getSnapshot().message,message);assert.equal(f.service.getSnapshot().tone,tone);
  }
  const f=storekit();f.state.purchase=async()=> 'pending';await f.service.purchase();assert.equal(f.service.getSnapshot().message,proMessage.pending);
});

test('restore synchronizes verified ownership, reports absent/failure, and verified refund revokes',async()=>{
  const f=storekit();await f.service.restore();assert.equal(f.service.getSnapshot().message,proMessage.none);assert.equal(f.state.syncs,1);
  await own(f);await f.service.restore();assert.equal(f.service.getSnapshot().message,proMessage.restored);
  const previous=f.service.current();f.state.evidence={kind:'revoked',proof};await f.service.refresh();assert.equal(f.service.current().unlimited,false);assert.throws(()=>f.service.assertCurrent(previous),/已改變/);assert.equal(f.service.getSnapshot().message,proMessage.revoked);
  f.state.syncError=error('network-error');await f.service.restore();assert.equal(f.service.getSnapshot().message,proMessage.restoreFailed);
});

test('known verified Pro survives transient offline errors but invalid signatures never grant or silently retain rights',async()=>{
  const f=storekit();await own(f);f.state.error=error('network-error');await f.service.refresh();assert.equal(f.service.getSnapshot().status,'unavailable');assert.equal(f.service.current().unlimited,true);
  const cold=storekit();cold.state.error=error('network-error');await cold.service.refresh();assert.equal(cold.service.current().unlimited,false);
  f.state.error=error('pro_verification');await f.service.refresh();assert.equal(f.service.current().unlimited,false);
  f.state.error=null;await f.service.refresh();assert.equal(f.service.current().unlimited,true);
  const restart=storekit();restart.state.evidence={kind:'active',proof};await restart.service.start();assert.equal(restart.service.current().unlimited,true);
});

test('transaction completion failure retries without redelivering Pro',async()=>{
  const f=storekit();f.state.finishError=error('service-error');await own(f);assert.equal(f.service.current().unlimited,true);assert.equal(f.service.getSnapshot().message,proMessage.finishing);
  f.state.finishError=null;await f.service.refresh();assert.deepEqual(f.state.finished,[proof.transactionId]);
});

test('native-verified JWS payload binding rejects wrong SKU, bundle, subscriptions and production Xcode payloads',()=>{
  const payload={productId:PRO_PRODUCT_ID,bundleId:'com.zhushunli.ordermori',type:'Non-Consumable',transactionId:'123',environment:'Sandbox'};
  const jws=p=>'header.'+Buffer.from(JSON.stringify(p)).toString('base64url')+'.signature';
  assert.equal(checkedStoreProof(jws(payload),payload.bundleId,false).revoked,false);
  assert.equal(checkedStoreProof(jws({...payload,revocationDate:1760000000000}),payload.bundleId,false).revoked,true);
  for(const p of [{...payload,productId:'fake'},{...payload,bundleId:'other'},{...payload,type:'Auto-Renewable Subscription'},{...payload,environment:'Xcode'},{...payload,expiresDate:123}])assert.throws(()=>checkedStoreProof(jws(p),payload.bundleId,false));
  assert.throws(()=>checkedStoreProof('not-jws',payload.bundleId,false));
});

test('Pro authority permits more than 15 creations, still records every event, then refund restores the Free cap',async()=>{
  const f=await fixture(),iap=storekit();const store=new OrderStore(f.adapter,randomUUID,()=>DATE,async()=> 'available',iap.service);
  try{await own(iap);for(let n=0;n<19;n++)await create(store);assert.equal((await store.getQuota()).used,19);assert.equal((await store.getHome()).quota.canCreate,true);
    const draft=await store.openDraft();await store.saveDraft(draft.requestId,1,input());assert.equal((await store.getQuota()).used,19);
    iap.state.evidence={kind:'revoked',proof};await iap.service.refresh();await assert.rejects(store.createOrder(draft.requestId,input()),e=>e.code==='quota');assert.equal((await store.getQuota()).used,19);
  }finally{f.db.close();}
});

test('revocation during order transaction rolls back the order and usage, retaining the draft',async()=>{
  const f=await fixture(),iap=storekit();await own(iap);let revoke=false;
  const adapter={...f.adapter,run:async(sql,p=[])=>{const result=await f.adapter.run(sql,p);if(revoke&&sql.startsWith('INSERT INTO quota_events')){iap.state.evidence={kind:'revoked',proof};await iap.service.refresh();}return result;}};
  const store=new OrderStore(adapter,randomUUID,()=>DATE,async()=> 'available',iap.service);
  try{const draft=await store.openDraft();revoke=true;await assert.rejects(store.createOrder(draft.requestId,input()),e=>e.code==='pro_changed');assert.equal((await store.getQuota()).used,0);assert.equal((await store.getHome()).orders.length,0);assert.equal((await store.getHome()).hasDraft,true);}finally{f.db.close();}
});

test('four template/locale combinations enforce branding, preserve customer text and identity, and never mutate old documents',async()=>{
  const f=await fixture(),iap=storekit();const store=new OrderStore(f.adapter,randomUUID,()=>DATE,async()=> 'available',iap.service);
  try{const id=await order(f);const old=buildNotice(await f.store.getNoticeContext(id)),oldKey=noticeSourceKey(old);
    await assert.rejects(store.saveNoticePreferences(id,1,0,{template:'editorial',locale:'en',includeNote:false,removeBranding:true}));
    await own(iap);assert.equal(noticeSourceKey(buildNotice(await store.getNoticeContext(id))),oldKey);
    for(const template of ['editorial','soft'])for(const locale of ['zh-HK','en']){
      const ctx=await store.getNoticeContext(id);await store.saveNoticePreferences(id,1,ctx.preferences.revision,{template,locale,includeNote:false,removeBranding:true});const d=buildNotice(await store.getNoticeContext(id));
      assert.equal(d.branding,'');assert.equal(d.totalCents,old.totalCents);assert.equal(d.items[0].name,old.items[0].name);assert.equal(noticeTextBlocks(d).brand,undefined);assert.match(noticeRenderIdentity(d),/:unbranded$/);
      const branded=buildNotice({...await store.getNoticeContext(id),canRemoveBranding:false});assert.equal(branded.branding,'Made with OrderMori');assert.notEqual(noticeSourceKey(branded),noticeSourceKey(d));
      const file=fileFor(d),mock={listNoticeFiles:async()=>[file],getNoticeContext:async()=>store.getNoticeContext(id)};
      await prepareNoticeExport(mock,file,async s=>digest(s),async()=> 'file:///synthetic.png');
      iap.state.evidence={kind:'revoked',proof};await iap.service.refresh();await assert.rejects(prepareNoticeExport(mock,file,async s=>digest(s),async()=> 'file:///synthetic.png'));await own(iap);
    }
    assert.equal(noticeSourceKey(old),oldKey);
  }finally{f.db.close();}
});

const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};
test('v6-v9 backups migrate to v10 without granting Pro or rewriting historic PNG hashes',async()=>{
  for(const version of [6,7,8,9]){const f=await fixture(version,true);try{
    await order(f);assert.equal(await checkSchema(f.adapter,reference),version);await migrateInspected(f.adapter);const data=await readBackupData(f.adapter);assert.equal(validateData(data).schemaVersion,10);assert.equal(data.notice_files.length,0);
    const ctx=await f.store.getNoticeContext(f.db.prepare('SELECT id FROM orders LIMIT 1').get().id);assert.equal(ctx.canRemoveBranding,undefined);assert.equal(buildNotice(ctx).branding,'Made with OrderMori');
  }finally{f.db.close();}}
});

test('v10 backup preserves branding intent/file metadata, but restoring cannot grant Pro; unknown entitlement data rejected',async()=>{
  const f=await fixture(),target=await fixture(),iap=storekit();const store=new OrderStore(f.adapter,randomUUID,()=>DATE,async()=> 'available',iap.service);
  try{const id=await order(f);await own(iap);await store.saveNoticePreferences(id,1,0,{template:'soft',locale:'en',includeNote:false,removeBranding:true});const doc=buildNotice(await store.getNoticeContext(id));const file=fileFor(doc);file.relativePath=`payment-notices/${file.id}.png`;await store.recordNoticeFile(file,noticeSourceKey(doc));
    const data=await readBackupData(f.adapter);validateData(data);assert.equal(data.notice_files[0].branding,'');assert.equal(await checkSchema(f.adapter,reference),10);
    await target.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),DATE));const restored=await target.store.getNoticeContext(id);assert.equal(restored.preferences.removeBranding,true);assert.equal(restored.canRemoveBranding,undefined);assert.equal(buildNotice(restored).branding,'Made with OrderMori');assert.equal((await target.store.listNoticeFiles(id))[0].branding,'');
    const forged=structuredClone(data);forged.app_state[0].is_pro=1;assert.throws(()=>validateData(forged));f.db.exec('PRAGMA query_only=OFF; CREATE TABLE fake_entitlement(is_pro INTEGER)');await assert.rejects(checkSchema(f.adapter,reference));
  }finally{f.db.close();target.db.close();}
});

test('Paywall copy uses Apple localized price in both languages, ownership and loading gates are present',async()=>{
  for(const locale of ['zh-HK','en']){await language.initialize({getItem:async()=>locale,setItem:async()=>{}},[]);assert.equal(tr`永久解鎖 · ${product.displayPrice}`,locale==='en'?'Unlock for life · ¥800':'永久解鎖 · ¥800');assert.equal(tr('恢復購買'),locale==='en'?'Restore Purchases':'恢復購買');}
  const source=readFileSync('app/shop/pro.tsx','utf8');assert.match(source,/pro\.product\.displayPrice/);assert.match(source,/disabled=\{busy \|\| !pro\.product/);assert.match(source,/pro\.hasPro/);assert.doesNotMatch(source,/HK\$88|\$4\.99|isPro/);
});

test('v9 to v10 is atomic and retryable, preserving all prior PNG hashes and default branding',async()=>{
  const f=await fixture(9,true);
  try{const id=await order(f),d=buildNotice(await f.store.getNoticeContext(id)),legacy=fileFor(d);delete legacy.branding;legacy.relativePath=`payment-notices/${legacy.id}.png`;
    await f.store.recordNoticeFile(legacy,noticeSourceKey(d));const oldRows=f.db.prepare('SELECT * FROM notice_files').all(),oldHash=noticeSourceKey(d);
    const broken={...f.adapter,exec:async sql=>{await f.adapter.exec(sql);if(sql.includes('ADD COLUMN branding'))throw Error('Synthetic v10 failure');}};
    await assert.rejects(new OrderStore(broken,randomUUID,()=>DATE).initialize());assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,9);assert.deepEqual(f.db.prepare('SELECT * FROM notice_files').all(),oldRows);assert.ok(!f.db.prepare('PRAGMA table_info(notice_preferences)').all().some(c=>c.name==='hide_branding'));
    await f.store.initialize();await f.store.initialize();assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,10);
    const saved=(await f.store.listNoticeFiles(id))[0];assert.equal(saved.dataHash,legacy.dataHash);assert.equal(saved.sha256,legacy.sha256);assert.equal(saved.branding,undefined);assert.equal(noticeSourceKey(buildNotice(await f.store.getNoticeContext(id))),oldHash);
  }finally{f.db.close();}
});

test('verified absence clears account ownership but temporary query errors preserve known rights',async()=>{
  const f=storekit();await own(f);f.state.evidence={kind:'absent'};await f.service.refresh();assert.equal(f.service.getSnapshot().status,'free');assert.equal(f.service.current().unlimited,false);
});
