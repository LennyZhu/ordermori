import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deflateSync } from 'node:zlib';
import { pngCrc } from '../src/domain/noticePixels.ts';
import { readNoticePngHeader } from '../src/domain/noticePng.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';
import { OrderStore } from '../src/data/store.ts';
import { blankInput, editable, financialProtectionMessage, toInput } from '../src/domain/model.ts';
import { emptyPayment } from '../src/domain/payment.ts';
import { buildNotice, noticeSourceKey, noticeStateReason } from '../src/domain/notice.ts';
import { SCHEMA_VERSION } from '../src/data/migrations.ts';
import { checkSchema, createSchema, migrateInspected, readBackupData, replaceData, mediaReferences, validateData, TABLES } from '../src/backup/data.ts';
import { copyEntry, inspectArchive, LIMITS, writeArchive } from '../src/backup/archive.ts';
import { parseManifest, verifySummary } from '../src/backup/manifest.ts';
import { fixture as schemaFixture, order as historicalOrder } from './helpers/notice-bilingual.mjs';

const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
const reference=async()=>{const db=new DatabaseSync(':memory:');return {db:port(db),close:async()=>db.close()};};
const hash=b=>createHash('sha256').update(b).digest('hex');
const now='2026-10-29T00:00:00.000Z';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function syntheticPng(width,height) {
  const chunk=(type,data)=>{const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE((pngCrc(Buffer.concat([name,data]))^0xffffffff)>>>0,out.length-4);return out;};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const rows=Buffer.alloc((width*4+1)*height,255);for(let y=0;y<height;y++)rows[y*(width*4+1)]=0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const byteSource=b=>({size:b.length,read:async(offset,n)=>new Uint8Array(b.subarray(offset,offset+n))});
async function archive(files){const chunks=[];await writeArchive(files.map(([path,b])=>({path,source:byteSource(b)})),{write:async b=>{chunks.push(Buffer.from(b));}});return Buffer.concat(chunks);}
async function extract(bytes){const entries=await inspectArchive(byteSource(bytes)),out={};for(const e of entries){const chunks=[];await copyEntry(byteSource(bytes),e,{write:async b=>{chunks.push(Buffer.from(b));}});out[e.path]=Buffer.concat(chunks);}return {entries,out};}
async function fixture(count=1,withMedia=true){
  const dir=mkdtempSync(join(tmpdir(),'ordermori-backup-test-')),path=join(dir,'live.sqlite'),db=new DatabaseSync(path),adapter=port(db);
  const store=new OrderStore(adapter,randomUUID,()=>now,async()=> 'available');await store.initialize();await store.saveShop('合成測試店舖','不是實際客戶資料');
  const media={};
  if(withMedia){const qrId=randomUUID(),shop=await store.getShop(),relativePath=`payment-assets/${qrId}.png`;media[relativePath]=png;
    await store.registerPaymentAsset({id:qrId,shopId:shop.id,kind:'fps',relativePath,mime:'image/png',bytes:png.length,sha256:hash(png),width:1,height:1});
    await store.savePaymentMethod('fps',{...emptyPayment(),qrAssetId:qrId,confirmed:true});
    await store.setDefaultPaymentMethod((await store.getPaymentSettings()).methods[0].methodId);
  }
  for(let i=0;i<count;i++){
    const draft=await store.openDraft(),id=await store.createOrder(draft.requestId,{...blankInput(randomUUID()),buyer:`synthetic-${i}`,items:[{id:randomUUID(),name:'合成商品',price:'117.00',quantity:'1'}],payment:draft.input.payment});
    if(withMedia && i===0){await store.saveNoticePreferences(id,1,0,{template:'soft',includeNote:false});const doc=buildNotice(await store.getNoticeContext(id)),fileId=randomUUID();
      const relativePath=`payment-notices/${fileId}.png`,noticePng=syntheticPng(1080,40);media[relativePath]=noticePng;
      await store.recordNoticeFile({id:fileId,orderId:id,shopId:doc.shopId,orderRevision:1,preferencesRevision:1,template:'soft',relativePath,width:1080,height:40,bytes:noticePng.length,sha256:hash(noticePng),dataHash:hash(noticeSourceKey(doc)),createdAt:now},noticeSourceKey(doc));
    }
  }
  const draft=await store.openDraft();await store.saveDraft(draft.requestId,1,{...draft.input,buyer:'未完成的合成草稿'});
  for(const [p,b] of Object.entries(media)){mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),b);}
  return {dir,path,db,adapter,store,media,cleanup(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
function snapshot(f,path){
  // Real SQLite Online Backup via Python, while the source is open in WAL mode.
  // Native app uses Expo's backupDatabaseAsync; this does not test Expo on iOS.
  execFileSync('/usr/bin/python3',['-c','import sqlite3,sys\ns=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',f.path,path]);
}

test('complete archive round-trip uses real WAL backup, all business rows, immutable media, hashes and a clean schema',async()=>{
  const f=await fixture(3);const target=await fixture(0,false);
  try{
    await f.store.saveProduct({name:'完整備份中的合成商品',price:'29.99'});
    const order=(await f.adapter.all('SELECT id FROM orders LIMIT 1'))[0];await f.store.changeStatus(order.id,1,'mark_paid','合成付款');await f.store.changeStatus(order.id,2,'fulfill','合成履約');
    const before=await readBackupData(f.adapter),snapshotPath=join(f.dir,'snapshot.sqlite');snapshot(f,snapshotPath);
    const copy=new DatabaseSync(snapshotPath);await checkSchema(port(copy),reference);const data=await readBackupData(port(copy));copy.close();
    assert.deepEqual(data,before);const refs=mediaReferences(data),summary=validateData(data);
    const files=[['data.sqlite',readFileSync(snapshotPath)],...refs.map(r=>[`media/${r.path}`,f.media[r.path]])];
    const manifest={format:'OrderMori',version:1,createdAt:now,schemaVersion:SCHEMA_VERSION,summary,files:files.map(([path,b])=>({path,size:b.length,sha256:hash(b)}))};
    const bytes=await archive([['manifest.json',Buffer.from(JSON.stringify(manifest))],...files]);
    const {entries,out}=await extract(bytes),parsed=parseManifest(out['manifest.json'].toString(),entries);verifySummary(parsed,summary);
    for(const record of parsed.files){assert.equal(hash(out[record.path]),record.sha256);assert.equal(out[record.path].length,record.size);}
    const generation=randomUUID(),mediaDir=join(target.dir,'restored',generation);
    for(const r of refs){const p=join(mediaDir,r.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,out[`media/${r.path}`]);}
    await target.store.maintenance(db=>replaceData(db,data,generation,randomUUID(),now));
    const restored=await readBackupData(target.adapter);
    for(const table of TABLES.filter(t=>!['app_state','backup_state','restore_receipts'].includes(t)))assert.deepEqual(restored[table],data[table],table);
    assert.equal(restored.app_state[0].created_count,3);assert.equal(restored.backup_state[0].media_generation,generation);
    assert.equal(restored.drafts[0].payload,data.drafts[0].payload);
    for(const r of refs)assert.equal(hash(readFileSync(join(mediaDir,r.path))),r.sha256);
    assert.deepEqual(await readBackupData(f.adapter),before);assert.ok(existsSync(join(f.dir,refs[0].path)));
    const reopened=new DatabaseSync(target.path);try{assert.equal(reopened.prepare('SELECT media_generation FROM backup_state').get().media_generation,generation);assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{reopened.close();}
  }finally{f.cleanup();target.cleanup();}
});

test('restore lower or higher usage retains max, local profile, sequence and coherent ledger/receipts across repeated restores',async()=>{
  for(const [localCount,backupCount] of [[9,0],[9,2],[2,9]]){
    const a=await fixture(localCount,false),b=await fixture(backupCount,false);try{
      const data=await readBackupData(b.adapter),profile=(await readBackupData(a.adapter)).app_state[0].profile_id;
      for(let i=0;i<2;i++)await a.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),now));
      const restored=await readBackupData(a.adapter);assert.equal(restored.app_state[0].created_count,Math.max(localCount,backupCount));assert.equal(restored.app_state[0].profile_id,profile);
      assert.equal(restored.creation_ledger.length,backupCount);assert.equal(restored.restore_receipts.length,2);assert.equal(restored.orders.length,backupCount);
      const d=await a.store.openDraft();await a.store.createOrder(d.requestId,{...d.input,buyer:'synthetic after restore',items:[{id:randomUUID(),name:'合成',price:'1.00',quantity:'1'}]});
      const after=await readBackupData(a.adapter);assert.equal(after.app_state[0].created_count,10);assert.equal(after.creation_ledger.length,backupCount+1);
    }finally{a.cleanup();b.cleanup();}
  }
});

test('failure after all row writes rolls back rows, media pointer, counters AND financial-lock triggers',async()=>{
  const a=await fixture(2,false),b=await fixture(1,false);try{
    const before=await readBackupData(a.adapter),data=await readBackupData(b.adapter);
    const triggerBefore=a.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
    await assert.rejects(a.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),now,async()=>{throw Error('synthetic mid-restore failure');})));
    assert.deepEqual(await readBackupData(a.adapter),before);assert.deepEqual(a.db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all(),triggerBefore);
    const order=before.orders[0];await a.store.changeStatus(order.id,1,'mark_paid','synthetic');
    assert.throws(()=>a.db.prepare('UPDATE orders SET total_cents=1 WHERE id=?').run(order.id));
    const reopened=new DatabaseSync(a.path);try{assert.equal(reopened.prepare('SELECT created_count FROM app_state').get().created_count,2);}finally{reopened.close();}
  }finally{a.cleanup();b.cleanup();}
});

const financialLockError = { code: 'backup', message: '備份訂單的付款紀錄與永久財務鎖不一致，未還原。' };

test('backup financial evidence accepts real payment transitions, including repeat payments after clock rollback', async () => {
  const f = await fixture(6);
  try {
    const [untouched, paid, corrected, repeated, refunded, cancelled] = f.db.prepare('SELECT id FROM orders ORDER BY order_number').all().map(row => row.id);
    let clock = '2026-10-29T04:00:00.000Z';
    const writer = new OrderStore(f.adapter, randomUUID, () => clock);
    for (const id of [paid, corrected, repeated, refunded]) await writer.changeStatus(id, 1, 'mark_paid', 'Synthetic payment');
    for (const id of [corrected, repeated]) await writer.changeStatus(id, 2, 'correct_payment', 'Synthetic correction');
    await writer.changeStatus(refunded, 2, 'refund', 'Synthetic refund');
    await writer.changeStatus(refunded, 3, 'cancel', 'Synthetic cancellation');
    await writer.changeStatus(cancelled, 1, 'cancel', 'Synthetic cancellation');
    await writer.changeStatus(paid, 2, 'fulfill', 'Synthetic handover');
    clock = '2026-10-29T03:00:00.000Z';
    await writer.changeStatus(repeated, 3, 'mark_paid', 'Synthetic repeated payment');

    const data = await readBackupData(f.adapter);
    const row = id => data.orders.find(order => order.id === id);
    assert.equal(row(untouched).financial_locked_at, null);
    assert.equal(row(cancelled).financial_locked_at, null);
    assert.equal(row(paid).payment_status, 'paid');
    assert.equal(row(corrected).payment_status, 'unpaid');
    assert.equal(row(corrected).paid_at, row(corrected).financial_locked_at);
    assert.equal(row(repeated).payment_status, 'paid');
    assert.equal(row(repeated).paid_at, clock);
    assert.equal(row(repeated).financial_locked_at, row(corrected).financial_locked_at);
    assert.equal(row(refunded).payment_status, 'refunded');
    assert.equal(row(refunded).order_status, 'cancelled');

    for (const [id, patch] of [
      [corrected, { financial_locked_at: null }],
      [paid, { financial_locked_at: null }],
      [corrected, { financial_locked_at: null, paid_at: null }],
      [corrected, { paid_at: null }],
      [untouched, { financial_locked_at: clock }],
      [repeated, { financial_locked_at: clock }],
      [refunded, { refunded_amount_cents: 1 }],
      [corrected, { refunded_at: clock }],
    ]) {
      assert.throws(() => validateData({ ...data, orders: data.orders.map(order => order.id === id ? { ...order, ...patch } : order) }), financialLockError);
    }
    const invalidHistory = data.status_history.map(event => event.order_id === corrected && event.from_value === 'paid'
      ? { ...event, to_value: 'invalid' } : event);
    assert.throws(() => validateData({ ...data, status_history: invalidHistory }), financialLockError);
  } finally { f.cleanup(); }
});

for (const version of [10, 11]) {
  test(`v${version} ZIP passes file checks; inconsistent staged financial evidence cannot replace data or media`, async () => {
    const target = await fixture(1);
    const input = await schemaFixture(version, false, join(target.dir, 'incoming.sqlite'));
    try {
      const id = await historicalOrder(input);
      const document = buildNotice(await input.store.getNoticeContext(id));
      const pngBytes = syntheticPng(1080, 40);
      const noticeId = randomUUID(), noticePath = `payment-notices/${noticeId}.png`;
      const sourceKey = noticeSourceKey(document);
      await input.store.recordNoticeFile({
        id: noticeId, orderId: id, shopId: document.shopId, orderRevision: document.orderRevision,
        preferencesRevision: document.preferencesRevision, template: document.template, locale: document.locale,
        relativePath: noticePath, width: 1080, height: 40, bytes: pngBytes.length, sha256: hash(pngBytes),
        dataHash: hash(sourceKey), createdAt: now,
      }, sourceKey);
      await input.store.changeStatus(id, 1, 'mark_paid', 'Synthetic payment');
      await input.store.changeStatus(id, 2, 'correct_payment', 'Synthetic correction');
      const valid = await readBackupData(input.adapter);
      assert.ok(valid.orders[0].financial_locked_at);
      const summary = { ...validateData(valid), schemaVersion: version };
      const snapshotPath = join(target.dir, 'snapshot.sqlite');
      snapshot({ path: join(target.dir, 'incoming.sqlite') }, snapshotPath);
      async function stage(label) {
        const files = [['data.sqlite', readFileSync(snapshotPath)], [`media/${noticePath}`, pngBytes]];
        const manifest = { format: 'OrderMori', version: 1, createdAt: now, schemaVersion: version, summary,
          files: files.map(([path, bytes]) => ({ path, size: bytes.length, sha256: hash(bytes) })) };
        const zipPath = join(target.dir, `${label}.ordermori.zip`);
        writeFileSync(zipPath, await archive([['manifest.json', Buffer.from(JSON.stringify(manifest))], ...files]));
        const source = byteSource(readFileSync(zipPath)), entries = await inspectArchive(source);
        async function checkedEntry(path) {
          const chunks = [];
          await copyEntry(source, entries.find(entry => entry.path === path), { write: async bytes => { chunks.push(Buffer.from(bytes)); } });
          return Buffer.concat(chunks);
        }
        const parsed = parseManifest((await checkedEntry('manifest.json')).toString(), entries);
        const out = new Map();
        for (const file of parsed.files) {
          const bytes = await checkedEntry(file.path);
          assert.equal(hash(bytes), file.sha256);
          assert.equal(bytes.length, file.size);
          out.set(file.path, bytes);
        }
        const stagedPath = join(target.dir, `${label}.sqlite`);
        writeFileSync(stagedPath, out.get('data.sqlite'));
        return { stagedPath, parsed, png: out.get(`media/${noticePath}`) };
      }
      const good = await stage('valid');
      const snapshotDb = new DatabaseSync(snapshotPath);
      try {
        // Preserve the permanent lock while making its evidence inconsistent.
        snapshotDb.prepare("UPDATE status_history SET recorded_at=? WHERE order_id=? AND axis='payment' AND to_value='paid'").run(now, id);
        assert.equal(snapshotDb.prepare('SELECT financial_locked_at FROM orders WHERE id=?').get(id).financial_locked_at, valid.orders[0].financial_locked_at);
        assert.equal(snapshotDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      } finally { snapshotDb.close(); }
      const bad = await stage('inconsistent');
      assert.deepEqual(bad.png, good.png);
      const { stagedPath, parsed } = good;
      const staged = new DatabaseSync(stagedPath);
      try {
        const adapter = port(staged);
        assert.equal(await checkSchema(adapter, reference), version);
        await migrateInspected(adapter);
        const trusted = await readBackupData(adapter);
        verifySummary(parsed, validateData(trusted));
        assert.deepEqual(trusted.orders, valid.orders);
        const generation = randomUUID();
        const targetData = await readBackupData(target.adapter);
        for (const ref of mediaReferences(targetData)) {
          const dest = join(target.dir, 'restored', generation, ref.path);
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, target.media[ref.path]);
        }
        await target.store.maintenance(db => replaceData(db, targetData, generation, randomUUID(), now));
        const before = await readBackupData(target.adapter);

        // Inject a missing field into the host read result after ZIP and Schema validation.
        const withoutLock = row => row.id === id ? { ...row, financial_locked_at: null } : row;
        const stagedFault = { ...adapter, all: async (sql, params) => {
          const rows = await adapter.all(sql, params);
          return sql === 'SELECT * FROM orders' ? rows.map(withoutLock) : rows;
        } };
        await assert.rejects(readBackupData(stagedFault), financialLockError);
        const inconsistent = { ...trusted, orders: trusted.orders.map(withoutLock) };
        let began = false;
        const targetPort = { ...target.adapter, exec: async sql => {
          began ||= sql === 'BEGIN IMMEDIATE';
          await target.adapter.exec(sql);
        } };
        const incoming = new DatabaseSync(bad.stagedPath);
        try {
          const incomingPort = port(incoming);
          assert.equal(await checkSchema(incomingPort, reference), version);
          await migrateInspected(incomingPort);
          assert.equal(incoming.prepare('PRAGMA user_version').get().user_version, 11);
          assert.equal(incoming.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
          assert.deepEqual(incoming.prepare('PRAGMA foreign_key_check').all(), []);
          await assert.rejects(async () => {
            const data = await readBackupData(incomingPort);
            await replaceData(targetPort, data, randomUUID(), randomUUID(), now);
          }, financialLockError);
          assert.equal(began, false);
        } finally { incoming.close(); }
        await assert.rejects(replaceData(targetPort, inconsistent, randomUUID(), randomUUID(), now), financialLockError);
        assert.equal(began, false);
        assert.deepEqual(await readBackupData(target.adapter), before);
        assert.equal(before.backup_state[0].media_generation, generation);
        for (const ref of mediaReferences(before)) assert.equal(hash(readFileSync(join(target.dir, 'restored', generation, ref.path))), ref.sha256);

        const retryGeneration = randomUUID();
        const restoredPng = join(target.dir, 'restored', retryGeneration, noticePath);
        mkdirSync(dirname(restoredPng), { recursive: true });
        writeFileSync(restoredPng, good.png);
        await target.store.maintenance(db => replaceData(db, trusted, retryGeneration, randomUUID(), now));
        const restored = await target.store.getOrder(id);
        assert.equal(restored.order.financial_locked_at, valid.orders[0].financial_locked_at);
        assert.deepEqual((await readBackupData(target.adapter)).order_payment_snapshots, trusted.order_payment_snapshots);
        assert.equal((await readBackupData(target.adapter)).backup_state[0].media_generation, retryGeneration);
        assert.equal(hash(readFileSync(restoredPng)), trusted.notice_files[0].sha256);
        await assert.rejects(target.store.updateOrder(id, restored.order.revision, {}), { code: 'locked' });
        assert.throws(() => target.db.prepare('DELETE FROM order_payment_snapshots WHERE order_id=?').run(id), /snapshot is locked/);
      } finally { staged.close(); }
    } finally { input.db.close(); target.cleanup(); }
  });
}

test('a pre-existing inconsistent active v10 history survives upgrade and still blocks backup and restore', async () => {
  const active = await schemaFixture(10);
  const source = await fixture(1);
  try {
    const id = await historicalOrder(active);
    await active.store.changeStatus(id, 1, 'mark_paid', 'Synthetic payment');
    await active.store.changeStatus(id, 2, 'correct_payment', 'Synthetic correction');
    active.db.prepare("UPDATE status_history SET recorded_at=? WHERE order_id=? AND axis='payment' AND to_value='paid'").run(now, id);
    const before = await active.store.getOrder(id);
    assert.ok(before.order.financial_locked_at);
    assert.equal(active.db.prepare('PRAGMA user_version').get().user_version, 10);
    await active.store.initialize();
    assert.equal(active.db.prepare('PRAGMA user_version').get().user_version, 11);
    assert.deepEqual(await active.store.getOrder(id), before);
    await assert.rejects(readBackupData(active.adapter), financialLockError);
    const replacement = await readBackupData(source.adapter);
    await assert.rejects(active.store.maintenance(db => replaceData(db, replacement, randomUUID(), randomUUID(), now)), financialLockError);
    assert.deepEqual(await active.store.getOrder(id), before);

    assert.equal(editable(before.order), false);
    await assert.rejects(active.store.updateOrder(id, before.order.revision, toInput(before)), { code: 'locked' });
    assert.throws(() => active.db.prepare('DELETE FROM order_payment_snapshots WHERE order_id=?').run(id), /snapshot is locked/);
    assert.equal(before.financialState, 'inconsistent');
    await assert.rejects(active.store.changeStatus(id, before.order.revision, 'mark_paid', ''), { code: 'locked', message: financialProtectionMessage });
    assert.deepEqual(await active.store.getOrder(id), before);
  } finally { active.db.close(); source.cleanup(); }
});

test('active v10 rows with missing financial locks stay readable after upgrade but reject all guarded Store writes', async () => {
  const active = await schemaFixture(10);
  try {
    const protectedError = { code: 'locked', message: financialProtectionMessage };
    const stale = [], ids = [];
    for (const keepPaidAt of [true, false]) {
      const id = await historicalOrder(active);
      ids.push(id);
      stale.push(await active.store.getOrder(id));
      // Seed legacy evidence on synthetic unpaid rows. SQLite keeps CHECKs,
      // foreign keys and all financial lock triggers enabled throughout.
      if (keepPaidAt) active.db.prepare('UPDATE orders SET paid_at=? WHERE id=?').run(now, id);
      const row = stale.at(-1).order;
      for (const [from, to] of [['unpaid', 'paid'], ['paid', 'unpaid']]) {
        active.db.prepare("INSERT INTO status_history VALUES(?,?,?,'payment',?,?,?,?)")
          .run(randomUUID(), id, row.shop_id, from, to, 'Synthetic legacy fixture', now);
      }
    }
    assert.equal(active.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(active.db.prepare('PRAGMA ignore_check_constraints').get().ignore_check_constraints, 0);
    assert.equal(active.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(active.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(await checkSchema(active.adapter, reference), 10);
    await assert.rejects(readBackupData(active.adapter), financialLockError);
    active.db.exec('PRAGMA query_only=OFF');
    const snapshot = table => active.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
    const tables = ['orders', 'order_items', 'status_history', 'order_payment_snapshots', 'notice_preferences', 'notice_files', 'payment_assets', 'backup_state'];
    const original = tables.map(snapshot);
    await active.store.initialize();
    assert.equal(active.db.prepare('PRAGMA user_version').get().user_version, 11);
    assert.deepEqual(tables.map(snapshot), original);
    assert.equal(await checkSchema(active.adapter, reference), 11);
    await assert.rejects(readBackupData(active.adapter), financialLockError);
    active.db.exec('PRAGMA query_only=OFF');

    for (const [index, id] of ids.entries()) {
      const detail = await active.store.getOrder(id);
      assert.equal(detail.order.financial_locked_at, null);
      assert.equal(detail.order.payment_status, 'unpaid');
      assert.equal(detail.order.paid_at, index === 0 ? now : null);
      assert.deepEqual(detail.items, stale[index].items);
      assert.deepEqual(detail.payment, stale[index].payment);
      assert.deepEqual(detail.history.filter(event => event.axis === 'payment')
        .map(event => [event.from_value, event.to_value]), [['unpaid', 'paid'], ['paid', 'unpaid']]);
      const notice = await active.store.getNoticeContext(id);
      assert.deepEqual(notice.detail.order, detail.order);
      assert.equal(noticeStateReason(notice.detail.order, notice.detail.financialState), financialProtectionMessage);
      assert.equal(editable(stale[index].order, stale[index].financialState), true);
      const input = toInput(stale[index]);
      await assert.rejects(active.store.updateOrder(id, stale[index].order.revision,
        { ...input, discount: '1.00', items: input.items.map(item => ({ ...item, price: '2.00' })) }), protectedError);
      await assert.rejects(active.store.updateOrder(id, detail.order.revision, { ...input, payment: null }), protectedError);
      const method = (await active.store.getPaymentSettings()).methods[0];
      await assert.rejects(active.store.updateOrder(id, detail.order.revision, { ...input, payment: method }), protectedError);
      for (const action of ['mark_paid', 'cancel']) {
        await assert.rejects(active.store.changeStatus(id, detail.order.revision, action, ''), protectedError);
      }
      await assert.rejects(active.store.saveNoticePreferences(id, detail.order.revision, 0, { template: 'soft', includeNote: false }), protectedError);
      await assert.rejects(active.store.completeNoticeShopSnapshot(id, detail.order.revision, { name: 'New shop', description: '' }), protectedError);
      await assert.rejects(active.store.recordNoticeFile({ orderId: id }, ''), { code: 'notice', message: financialProtectionMessage });
      assert.equal(detail.financialState, 'inconsistent');
      assert.equal(editable(detail.order, detail.financialState), false);
      assert.deepEqual(await active.store.getOrder(id), detail);
    }
    assert.deepEqual(tables.map(snapshot), original);
  } finally { active.db.close(); }
});

test('maintenance drains prior writes, rejects new writes and releases after failure',async()=>{
  const f=await fixture(0,false);try{
    const earlier=f.store.saveShop('先前排隊資料','');let entered,release;const ready=new Promise(r=>{entered=r;});
    const pending=f.store.maintenance(async db=>{assert.equal((await db.first('SELECT name FROM shops')).name,'先前排隊資料');entered();await new Promise(r=>{release=r;});throw Error('synthetic failure');});
    await ready;await earlier;await assert.rejects(f.store.saveShop('不應寫入',''),e=>e.code==='maintenance');release();await assert.rejects(pending);
    await f.store.saveShop('恢復可寫','');assert.equal((await f.store.getShop()).name,'恢復可寫');
  }finally{f.cleanup();}
});

test('old v1-v5 and early incomplete v3/v4 migrate only on inspected copies without losing records',async()=>{
  for(const [v,early,broken] of [[1,false,false],[2,false,false],[3,false,false],[3,true,false],[4,true,true],[4,true,false],[5,false,false],[5,true,false]]){
    const db=new DatabaseSync(':memory:');try{
      const p=port(db);await createSchema(p,v,early,broken);
      db.prepare('INSERT INTO shops(id,name,description,updated_at) VALUES(?,?,?,?)').run('synthetic-shop','合成舊店','',now);
      db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('synthetic-profile','synthetic-shop');
      assert.equal(await checkSchema(p,reference),v);await migrateInspected(p);const data=await readBackupData(p);assert.equal(data.shops[0].name,'合成舊店');assert.equal(data.app_state[0].profile_id,'synthetic-profile');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);assert.equal(data.app_state[0].created_count,0);
    }finally{db.close();}
  }
});

test('unknown schemas, too-new DB and fake Pro tables/columns are rejected before imported SQL can run',async()=>{
  for(const sql of ['PRAGMA user_version=99','CREATE TABLE entitlement(pro INTEGER)','ALTER TABLE app_state ADD COLUMN pro INTEGER DEFAULT 1',"CREATE TRIGGER malicious AFTER INSERT ON shops BEGIN DELETE FROM orders; END"]){
    const f=await fixture(0,false);try{f.db.exec(sql);await assert.rejects(checkSchema(f.adapter,reference),e=>e.code==='backup');}finally{f.cleanup();}
  }
  const f=await fixture(1,true);try{f.db.exec("UPDATE payment_methods SET payload=json_set(payload,'$.pro',1)");await assert.rejects(readBackupData(f.adapter),e=>e.code==='backup');}finally{f.cleanup();}
});

test('invalid count/ledger, broken foreign keys and inconsistent item totals never become trusted restore data',async()=>{
  for(const corrupt of ['count','ledger','foreign','amount']){
    const f=await fixture(1,false);try{
      if(corrupt==='count')f.db.exec('UPDATE app_state SET created_count=5,order_number_seq=5');
      if(corrupt==='ledger')f.db.exec('DELETE FROM creation_ledger');
      if(corrupt==='foreign')f.db.exec("PRAGMA foreign_keys=OFF; UPDATE orders SET shop_id='missing'");
      if(corrupt==='amount')f.db.exec('PRAGMA ignore_check_constraints=ON; UPDATE order_items SET line_total_cents=1');
      await assert.rejects(readBackupData(f.adapter));
    }finally{f.cleanup();}
  }
});

test('archive rejects path traversal, absolute/encoded/backslash paths, duplicates, symlinks, compression and malformed structure',async()=>{
  for(const path of ['../data.sqlite','/data.sqlite','media/../../data.sqlite','media/%2e%2e/data.sqlite','media\\bad.png','purchase.json']){
    const bytes=zipSync({'manifest.json':strToU8('{}'),'data.sqlite':strToU8('x'),[path]:strToU8('x')},{level:0});await assert.rejects(inspectArchive(byteSource(bytes)));
  }
  const good=await archive([['manifest.json',Buffer.from('{}')],['data.sqlite',Buffer.from('x')]]);
  for(const kind of ['symlink','duplicate','header','truncated','encrypted','size']){
    let bad=Buffer.from(good);const end=bad.length-22,central=bad.readUInt32LE(end+16);
    if(kind==='symlink')bad.writeUInt32LE(0xa1ff0000,central+38);
    if(kind==='duplicate')bad=await archive([['manifest.json',Buffer.from('{}')],['data.sqlite',Buffer.from('x')],['data.sqlite',Buffer.from('y')]]);
    if(kind==='header')bad[0]=0;
    if(kind==='truncated')bad=bad.subarray(0,bad.length-1);
    if(kind==='encrypted')bad.writeUInt16LE(1,central+8);
    if(kind==='size')bad.writeUInt32LE(LIMITS.file+1,central+24);
    await assert.rejects(inspectArchive(byteSource(bad)),kind);
  }
  const compressed=zipSync({'manifest.json':strToU8('{}'),'data.sqlite':new Uint8Array(10000)},{level:6});await assert.rejects(inspectArchive(byteSource(compressed)));
  await assert.rejects(inspectArchive({size:LIMITS.total+1000000,read:async()=>assert.fail('must reject before read')}));
});

test('chunked archive CRC and SHA-256 reject corruption/missing file; summaries must match actual SQL data',async()=>{
  const large=Buffer.alloc(200000,7),db=Buffer.from('sqlite fixture');
  const m={format:'OrderMori',version:1,createdAt:now,schemaVersion:6,summary:{orders:1,items:1,media:0,createdCount:1,profileId:'test',schemaVersion:6},files:[{path:'data.sqlite',size:db.length,sha256:hash(db)}]};
  const good=await archive([['manifest.json',Buffer.from(JSON.stringify(m))],['data.sqlite',db]]),r=await extract(good);parseManifest(r.out['manifest.json'].toString(),r.entries);
  const bad=Buffer.from(good),e=r.entries.find(e=>e.path==='data.sqlite');bad[e.offset]^=1;await assert.rejects(extract(bad));
  assert.throws(()=>parseManifest(JSON.stringify({...m,version:99}),r.entries));assert.throws(()=>parseManifest(JSON.stringify({...m,files:[]}),r.entries));assert.throws(()=>verifySummary(m,{...m.summary,orders:2}));
  const multi=await archive([['manifest.json',Buffer.from('{}')],['data.sqlite',large]]);assert.deepEqual((await extract(multi)).out['data.sqlite'],large);
});

test('select/inspect/cancel without commit leaves live SQL and media bytes unchanged',async()=>{
  const f=await fixture(1,true);try{
    const before=await readBackupData(f.adapter),path=join(f.dir,'cancelled-snapshot.sqlite');snapshot(f,path);
    const db=new DatabaseSync(path);try{await checkSchema(port(db),reference);await migrateInspected(port(db));await readBackupData(port(db));}finally{db.close();}
    assert.deepEqual(await readBackupData(f.adapter),before);for(const [p,b] of Object.entries(f.media))assert.deepEqual(readFileSync(join(f.dir,p)),b);
  }finally{f.cleanup();}
});

test('missing, corrupt, wrong-format or wrong-dimension media abort before the restore transaction',async()=>{
  const {verifyBackupMedia}=await import('../src/backup/media.ts');
  const f=await fixture(1,true);try{
    const data=await readBackupData(f.adapter),refs=mediaReferences(data),before=await readBackupData(f.adapter);
    const io={size:async p=>f.media[p]?.length??null,hash:async p=>hash(f.media[p]),header:async p=>f.media[p].subarray(0,24),dimensions:async p=>readNoticePngHeader(f.media[p])};
    await verifyBackupMedia(refs,io);
    for(const kind of ['missing','hash','format','dimensions']){
      const bad={...io};if(kind==='missing')bad.size=async()=>null;if(kind==='hash')bad.hash=async()=> '0'.repeat(64);if(kind==='format')bad.header=async()=>new Uint8Array(24);if(kind==='dimensions')bad.dimensions=async()=>({width:999,height:999});
      await assert.rejects(verifyBackupMedia(refs,bad),e=>e.code==='backup');assert.deepEqual(await readBackupData(f.adapter),before);
    }
  }finally{f.cleanup();}
});

test('a lost COMMIT acknowledgement is resolved from the committed root; completed restore survives reopening',async()=>{
  const a=await fixture(2,false),b=await fixture(1,false);try{
    const data=await readBackupData(b.adapter),generation=randomUUID();
    const adapter={...a.adapter,exec:async sql=>{await a.adapter.exec(sql);if(sql==='COMMIT')throw Error('synthetic lost acknowledgement');}};
    await replaceData(adapter,data,generation,randomUUID(),now);
    const reopened=new DatabaseSync(a.path);try{const restored=await readBackupData(port(reopened));assert.equal(restored.backup_state[0].media_generation,generation);assert.equal(restored.orders.length,1);assert.equal(restored.app_state[0].created_count,2);}finally{reopened.close();}
  }finally{a.cleanup();b.cleanup();}
});

test('a retired store cannot write to the old connection after restoration',async()=>{
  const f=await fixture(0,false);try{f.store.retire();await assert.rejects(f.store.saveShop('stale component',''));await assert.rejects(f.store.maintenance(async()=>{}));}finally{f.cleanup();}
});

test('restoring independent previously-restored profiles uses the new baseline instead of summing unrelated ledger sequences',async()=>{
  const a=await fixture(4,false),b=await fixture(2,false),c=await fixture(1,false);try{
    const seed=await readBackupData(c.adapter);
    await a.store.maintenance(db=>replaceData(db,seed,randomUUID(),randomUUID(),now));
    await b.store.maintenance(db=>replaceData(db,seed,randomUUID(),randomUUID(),now));
    const draft=await b.store.openDraft();await b.store.createOrder(draft.requestId,{...draft.input,buyer:'synthetic independent profile',items:[{id:randomUUID(),name:'合成',price:'1.00',quantity:'1'}]});
    const incoming=await readBackupData(b.adapter);assert.equal(incoming.app_state[0].created_count,3);
    await a.store.maintenance(db=>replaceData(db,incoming,randomUUID(),randomUUID(),now));
    const restored=await readBackupData(a.adapter);assert.equal(restored.app_state[0].created_count,4);
    assert.equal(restored.creation_ledger.length,2);assert.equal(restored.restore_receipts.length,3);
  }finally{a.cleanup();b.cleanup();c.cleanup();}
});

test('an over-limit valid archive restores all history but grants no Pro or additional Free creations',async()=>{
  const a=await fixture(0,false),b=await fixture(9,false);try{
    // Simulate valid history created by a future entitlement-enabled build;
    // there is deliberately no entitlement table or Pro flag in this archive.
    for(const ordinal of [10,11,12,13,14,15,16]) {
    const order={...b.db.prepare('SELECT * FROM orders LIMIT 1').get(),id:randomUUID(),creation_request_id:randomUUID(),order_number:`OM-${String(ordinal).padStart(6,'0')}`};
    const item={...b.db.prepare('SELECT * FROM order_items LIMIT 1').get(),id:randomUUID(),order_id:order.id};
    for(const [table,row] of [['orders',order],['order_items',item]]){const keys=Object.keys(row);b.db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
    b.db.prepare('INSERT INTO quota_events(request_id,order_id,period,recorded_at) VALUES(?,?,?,?)').run(order.creation_request_id,order.id,'2026-10',now);
    b.db.prepare('INSERT INTO creation_ledger(event_id,order_id,allocated_number,created_at) VALUES(?,?,?,?)').run(randomUUID(),order.id,ordinal,now);
    }
    b.db.exec('UPDATE app_state SET created_count=16,order_number_seq=16');
    const data=await readBackupData(b.adapter);await a.store.maintenance(db=>replaceData(db,data,randomUUID(),randomUUID(),now));
    const restored=await readBackupData(a.adapter);assert.equal(restored.orders.length,16);assert.equal(restored.app_state[0].created_count,16);
    const draft=await a.store.openDraft();await assert.rejects(a.store.createOrder(draft.requestId,{...draft.input,buyer:'synthetic',items:[{id:randomUUID(),name:'合成',price:'1.00',quantity:'1'}]}),e=>e.code==='quota');
    assert.equal((await readBackupData(a.adapter)).orders.length,16);
  }finally{a.cleanup();b.cleanup();}
});
