import { DatabaseSync } from 'node:sqlite';
import { OrderStore } from '../../src/data/store.ts';
import { createSchema } from '../../src/backup/data.ts';
import { SCHEMA_VERSION } from '../../src/data/migrations.ts';
import { emptyPayment, snapshotOf } from '../../src/domain/payment.ts';
export const DATE='2026-10-29T16:05:00.000Z';
export const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
export async function fixture(version=SCHEMA_VERSION,legacy=false,path=':memory:') {
  const db=new DatabaseSync(path),adapter=port(db);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  await createSchema(adapter,version,legacy,false,legacy);
  db.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('synthetic-shop','小滿手作','Far',DATE);
  db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('synthetic-profile','synthetic-shop');
  let sequence=0;const newId=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  return {db,adapter,newId,store:new OrderStore(adapter,newId,()=>DATE,async()=> 'available')};
}
export async function order(f,{count=1,note='原文備註 Note',shipping='sf_collect',discount='',price='117.00'}={}) {
  await f.store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC MERCHANT',accountNumber:'TEST ONLY',confirmed:true});
  const method=(await f.store.getPaymentSettings()).methods.find(m=>m.kind==='bank');
  const draft=await f.store.openDraft();
  const id=await f.store.createOrder(draft.requestId,{...draft.input,buyer:'合成買家 Buyer',note,shipping,shippingFee:shipping==='custom'?'20.00':'0',discount,
    items:Array.from({length:count},(_,i)=>({id:`item-${i}`,name:`第 ${i+1} 件 合成商品 Product`,price,quantity:'1'})),payment:snapshotOf(method)});
  return id;
}
