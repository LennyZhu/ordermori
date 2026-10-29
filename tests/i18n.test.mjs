import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import { catalog } from '../src/i18n/catalog.ts';
import { language, tr, trMessage, t } from '../src/i18n/index.ts';
import { LanguageController, resolveSystemLocale, LANGUAGE_KEY } from '../src/i18n/preferences.ts';
import { OrderStore } from '../src/data/store.ts';
import { appendCatalogProduct } from '../src/domain/catalog.ts';
import { buildNotice, noticeSourceKey } from '../src/domain/notice.ts';
import { emptyPayment, snapshotOf } from '../src/domain/payment.ts';
import { FREE_LIMIT, blankInput, evaluate } from '../src/domain/model.ts';
import { readBackupData } from '../src/backup/data.ts';
const storage = (initial=null) => { const data=new Map(initial ? [[LANGUAGE_KEY,initial]] : []); return {data,getItem:async key=>data.get(key)??null,setItem:async(key,value)=>{data.set(key,value);}}; };
const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});

// Tests using the shared translator are deliberately sequential in this file.
test('every catalog message has both languages and identical interpolation variables',()=>{
  const ids=new Set(),sources=new Set();
  for(const m of catalog){assert.ok(m.zh.trim()&&m.en.trim(),m.id);assert.ok(!ids.has(m.id));assert.ok(!sources.has(m.zh),m.zh);ids.add(m.id);sources.add(m.zh);
    const params=s=>[...s.matchAll(/%\{(v\d+)\}/g)].map(x=>x[1]).sort();assert.deepEqual(params(m.zh),params(m.en),m.id);
    if(!['語言 / Language','繁體中文（香港）'].includes(m.zh))assert.ok(!/\p{Script=Han}/u.test(m.en),m.id);
  }
});
test('system/app language uses the first preference and unsupported languages fall back to zh-HK',()=>{
  for(const tags of [[],['fr-FR'],['ja-JP','en'],['zh-Hant-HK'],['zh-HK'],['de-DE']])assert.equal(resolveSystemLocale(tags),'zh-HK');
  for(const tags of [['en'],['en-US'],['en_HK'],['en-GB','zh-HK']])assert.equal(resolveSystemLocale(tags),'en');
});
test('manual language changes persist, notify immediately after storage and survive restarting the controller',async()=>{
  const db=storage(),first=new LanguageController();await first.initialize(db,['en-HK']);let changes=0;first.subscribe(()=>changes++);
  await first.select('zh-HK');assert.equal(first.locale,'zh-HK');assert.equal(changes,1);assert.equal(db.data.get(LANGUAGE_KEY),'zh-HK');
  const restarted=new LanguageController();await restarted.initialize(db,['en']);assert.equal(restarted.preference,'zh-HK');assert.equal(restarted.locale,'zh-HK');
  await first.select('system');assert.equal(first.locale,'en');first.setSystem(['fr']);assert.equal(first.locale,'zh-HK');
});
test('invalid stored preference is not erased; failed saves leave current preference intact and rapid selections serialize',async()=>{
  const db=storage('bad-value'),c=new LanguageController();await c.initialize(db,['en']);assert.equal(c.preference,'system');assert.equal(db.data.get(LANGUAGE_KEY),'bad-value');
  let fail=true;const broken={...db,setItem:async(k,v)=>{if(fail)throw Error('synthetic storage failure');await db.setItem(k,v);}};
  await c.initialize(broken,['en']);await assert.rejects(c.select('zh-HK'));assert.equal(c.locale,'en');fail=false;
  await Promise.all([c.select('en'),c.select('zh-HK'),c.select('system')]);assert.equal(c.preference,'system');assert.equal(db.data.get(LANGUAGE_KEY),'system');
});
test('all authored interface messages translate; interpolated customer values stay exactly as entered',async()=>{
  await language.initialize(storage('en'),['zh-HK']);assert.equal(t('newOrder'),'New order');
  for(const m of catalog){const params=Object.fromEntries([...m.zh.matchAll(/%\{(v\d+)\}/g)].map(x=>[x[1],'USER_VALUE']));const source=m.zh.replace(/%\{(v\d+)\}/g,(_,key)=>params[key]);assert.equal(trMessage(source),m.en.replace(/%\{(v\d+)\}/g,(_,key)=>params[key]),m.id);}
  const customer='小滿手作 ${name} <>& %{v0}';assert.equal(tr`已加入「${customer}」× 1，可繼續選取。`,`Added “${customer}” × 1. You can keep selecting.`);
  await language.select('zh-HK');assert.equal(tr`已加入「${customer}」× 1，可繼續選取。`,`已加入「${customer}」× 1，可繼續選取。`);
});
test('form validation, confirmations, asynchronous canonical errors and nested payment status translate on each render',async()=>{
  await language.initialize(storage('en'),[]);
  assert.equal(trMessage('請填寫商品名稱。'),'Enter a product name.');assert.equal(tr('移除常用商品？'),'Remove saved product?');
  assert.match(trMessage('草稿未能儲存。請檢查並修正標示的欄位。'),/^Could not save draft\. Check/);
  assert.match(trMessage('FPS 轉數快資料已儲存。'),/^FPS details saved/);
  assert.equal(trMessage('請匯入 PayMe 官方收款碼。\n請核對資料後勾選商家確認。'),'Import an official PayMe payment code.\nCheck the details, then select merchant confirmation.');
  await language.select('zh-HK');assert.equal(trMessage('請填寫商品名稱。'),'請填寫商品名稱。');
});
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${dir}/${e.name}`):e.name.endsWith('.tsx')?[`${dir}/${e.name}`]:[]);}
test('every explicit translated literal/template in formal UI has a catalog entry',()=>{
  const sources=new Set(catalog.map(m=>m.zh));let count=0;
  for(const file of [...files('app'),...files('src/ui'),'src/AppProvider.tsx','src/i18n/react.tsx']){const source=readFileSync(file,'utf8'),sf=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=n=>{let key;if(ts.isCallExpression(n)&&n.expression.getText(sf)==='tr'&&n.arguments[0]&&(ts.isStringLiteral(n.arguments[0])||ts.isNoSubstitutionTemplateLiteral(n.arguments[0])))key=n.arguments[0].text;
      if(ts.isTaggedTemplateExpression(n)&&n.tag.getText(sf)==='tr')key=ts.isNoSubstitutionTemplateLiteral(n.template)?n.template.text:n.template.head.text+n.template.templateSpans.map((s,i)=>`%{v${i}}`+s.literal.text).join('');
      if(key){assert.ok(sources.has(key),`${file}: ${key}`);count++;}ts.forEachChild(n,visit);};visit(sf);
  }assert.ok(count>300);
});
test('switching languages never remounts the router/editor or changes effect dependencies for draft loading',()=>{
  const root=readFileSync('app/_layout.tsx','utf8'),provider=readFileSync('src/i18n/react.tsx','utf8'),editor=readFileSync('src/ui/OrderEditor.tsx','utf8');
  assert.match(root,/<LanguageProvider>/);assert.doesNotMatch(root+provider+editor,/key=\{(?:locale|preference|language)/);
  assert.match(editor,/\}, \[store, orderId, retry\]\)/);assert.match(editor,/useLanguage\(\)/);assert.match(provider,/ordermori-device-preferences\.db/);
});
test('real SQLite orders, draft inputs, prices, quota, payment snapshots and PNG source stay unchanged after switching',async()=>{
  const db=new DatabaseSync(':memory:'),store=new OrderStore(port(db),randomUUID);
  try{await store.initialize();await store.saveShop('小滿手作','Shop 原文');const productId=await store.saveProduct({name:'中文 Product',price:'128.00'}),p=await store.getProduct(productId);
    await store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC',accountNumber:'TEST ONLY',confirmed:true});
    const method=(await store.getPaymentSettings()).methods[0],draft=await store.openDraft(),input={...appendCatalogProduct(draft.input,p,randomUUID()),buyer:'買家 Buyer',note:'原文 note',payment:snapshotOf(method)};
    const orderId=await store.createOrder(draft.requestId,input),next=await store.openDraft();await store.saveDraft(next.requestId,1,{...next.input,buyer:'未儲存 buyer',note:'keep 備註'});
    const before=await readBackupData(port(db)),notice=buildNotice(await store.getNoticeContext(orderId)),key=noticeSourceKey(notice);
    await language.initialize(storage('system'),['en-HK']);await language.select('en');await language.select('zh-HK');await language.select('system');
    assert.deepEqual(await readBackupData(port(db)),before);assert.deepEqual(buildNotice(await store.getNoticeContext(orderId)),notice);assert.equal(noticeSourceKey(notice),key);assert.equal(notice.locale,'zh-HK');assert.equal((await store.getOrder(orderId)).order.total_cents,12800);assert.equal(FREE_LIMIT,10);
  }finally{db.close();}
});
test('native language config merges signing, preserves media ABI fix and declares localized permission strings',()=>{
  const require=createRequire(import.meta.url),configure=require('../app.config.js');const base={ios:{appleTeamId:'SYNTHETIC',bundleIdentifier:'synthetic.test',infoPlist:{Existing:true}},plugins:['existing'],locales:{fr:{test:'test'}}},config=configure({config:base});
  assert.equal(config.ios.appleTeamId,base.ios.appleTeamId);assert.equal(config.ios.bundleIdentifier,base.ios.bundleIdentifier);assert.equal(config.ios.infoPlist.Existing,true);assert.deepEqual(config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-localization')[1].supportedLocales.ios,['zh-HK','en']);
  assert.ok(config.locales.fr);for(const locale of ['en','zh-HK']){const copy=JSON.parse(readFileSync(config.locales[locale],'utf8'));assert.ok(copy.NSPhotoLibraryUsageDescription&&copy.NSPhotoLibraryAddUsageDescription);}
  assert.deepEqual(JSON.parse(readFileSync('package.json','utf8')).expo.autolinking.ios.buildFromSource,['expo-media-library']);
});

test('formal UI has no untranslated literal JSX text or string attributes outside the intentionally frozen PNG paper',()=>{
  for(const file of [...files('app'),...files('src/ui'),'src/AppProvider.tsx'].filter(p=>!p.endsWith('NoticePaper.tsx'))){const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=n=>{if(ts.isJsxText(n))assert.ok(!/\p{Script=Han}/u.test(n.text),`${file}: raw JSX text ${n.text}`);
      if(ts.isJsxAttribute(n)&&n.initializer&&ts.isStringLiteral(n.initializer))assert.ok(!/\p{Script=Han}/u.test(n.initializer.text),`${file}: raw attribute ${n.name.getText(sf)}`);
      if(ts.isJsxExpression(n)&&n.expression&&ts.isJsxElement(n.parent)&&n.parent.openingElement.tagName.getText(sf)==='Text'){
        const value=n.expression;
        assert.ok(!(ts.isPropertyAccessExpression(value)&&value.expression.getText(sf)==='fields')&&!(ts.isIdentifier(value)&&value.text==='problem'),`${file}: untranslated canonical diagnostic`);
      }
      if(ts.isTemplateExpression(n)&&!(ts.isTaggedTemplateExpression(n.parent)&&n.parent.tag.getText(sf)==='tr')&&/\p{Script=Han}/u.test(n.head.text+n.templateSpans.map(span=>span.literal.text).join(''))){
        let parent=n.parent;while(parent&&!ts.isTaggedTemplateExpression(parent))parent=parent.parent;
        assert.ok(!parent||parent.tag.getText(sf)!=='tr',`${file}: untranslated nested message`);
      }
      ts.forEachChild(n,visit);};visit(sf);
  }
});
test('canonical domain/data/backup errors and field validation messages all have English catalog coverage',()=>{
  const sources=new Set(catalog.map(m=>m.zh));let checked=0;
  const walkFiles=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walkFiles(`${dir}/${e.name}`):e.name.endsWith('.ts')?[`${dir}/${e.name}`]:[]);
  for(const file of [...walkFiles('src/domain'),...walkFiles('src/data'),...walkFiles('src/backup')]){const sf=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
    const visit=n=>{if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)){
      const key=ts.isTemplateExpression(n)?n.head.text+n.templateSpans.map((s,i)=>`%{v${i}}`+s.literal.text).join(''):n.text;
      if(/\p{Script=Han}/u.test(key)){let parent=n.parent,authored=false;while(parent&&!ts.isFunctionLike(parent)){
        if(ts.isNewExpression(parent)&&parent.expression.getText(sf)==='DomainError'||ts.isCallExpression(parent)&&parent.expression.getText(sf)==='failBackup'||ts.isBinaryExpression(parent)&&/^fields\./.test(parent.left.getText(sf))){authored=true;break;}parent=parent.parent;}
        if(authored){assert.ok(sources.has(key),`${file}: missing error ${key}`);checked++;}
      }
    }ts.forEachChild(n,visit);};visit(sf);
  }assert.ok(checked>150);
});


test('collection/total validation and notice feedback translate without changing canonical errors or customer data',async()=>{
  await language.initialize(storage('en'),['zh-HK']);
  const base={...blankInput('item'),buyer:'合成買家'};
  for(const [input,field,english] of [
    [{...base,items:[]},'items','Each order needs 1–20 items.'],
    [{...base,items:[{id:'item',name:'原文 Product',price:'0.00',quantity:'1'}]},'total','A saved order’s total due must be greater than 0.'],
  ]){
    const before=structuredClone(input);let error;try{evaluate(input);}catch(cause){error=cause;}
    assert.ok(error?.fields[field]);assert.equal(trMessage(error.fields[field]),english);assert.deepEqual(input,before);
  }
  assert.equal(trMessage('已取消訂單不能產生新的付款通知。'),'Cancelled orders cannot generate new payment notices.');
  assert.equal(tr`擷取 ${'0.25'} 秒`,'Captured in 0.25 seconds');
  const canonical='本機資料操作未能完成，請重試。資料不會因此自動清除。';
  const feedback=trMessage(canonical)+tr(' 以下可能為上次讀取的資料。');
  assert.match(feedback,/local data operation failed/);assert.match(feedback,/last successful read/);assert.doesNotMatch(feedback,/\p{Script=Han}/u);
  await language.select('zh-HK');assert.equal(trMessage(canonical),canonical);
});
