import { DatabaseSync } from 'node:sqlite';
import { OrderStore } from '../../src/data/store.ts';
import { createSchema } from '../../src/backup/data.ts';
import { SCHEMA_VERSION } from '../../src/data/migrations.ts';
import { emptyPayment, snapshotOf } from '../../src/domain/payment.ts';
import { evaluate } from '../../src/domain/model.ts';
export const DATE='2026-10-29T16:05:00.000Z';
export const port=db=>({exec:async sql=>db.exec(sql),run:async(sql,p=[])=>db.prepare(sql).run(...p),first:async(sql,p=[])=>db.prepare(sql).get(...p)??null,all:async(sql,p=[])=>db.prepare(sql).all(...p)});
export async function fixture(version=SCHEMA_VERSION,legacy=false,path=':memory:') {
  const db=new DatabaseSync(path),adapter=port(db);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  await createSchema(adapter,version,legacy,false,legacy);
  db.prepare('INSERT INTO shops VALUES(?,?,?,?)').run('synthetic-shop','小滿手作','Far',DATE);
  db.prepare('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)').run('synthetic-profile','synthetic-shop');
  let sequence=0;const newId=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
  return {db,adapter,newId,version,store:new OrderStore(adapter,newId,()=>DATE,async()=> 'available')};
}
export async function order(f,{count=1,note='原文備註 Note',shipping='sf_collect',discount='',price='117.00'}={}) {
  await f.store.savePaymentMethod('bank',{...emptyPayment(),bankName:'合成銀行',accountName:'SYNTHETIC MERCHANT',accountNumber:'TEST ONLY',confirmed:true});
  const method=(await f.store.getPaymentSettings()).methods.find(m=>m.kind==='bank');
  const draft=await f.store.openDraft();
  const input={...draft.input,buyer:'合成買家 Buyer',note,shipping,shippingFee:shipping==='custom'?'20.00':'0',discount,
    items:Array.from({length:count},(_,i)=>({id:`item-${i}`,name:`第 ${i+1} 件 合成商品 Product`,price,quantity:'1'})),payment:snapshotOf(method)};
  // Reproduce the shipped pre-v9 writer on real historical schemas. The live
  // store deliberately refuses to create without its new quota tables.
  const id=f.version<9 ? legacyOrder(f,draft.requestId,input) : await f.store.createOrder(draft.requestId,input);
  return id;
}
function legacyOrder(f,requestId,input) {
  const {db,newId}=f,state=db.prepare('SELECT * FROM app_state').get(),shop=db.prepare('SELECT * FROM shops').get(),v=evaluate(input),id=newId(),ordinal=state.order_number_seq+1;
  db.exec('BEGIN IMMEDIATE');try{
    db.prepare(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'active','unpaid','pending',?,?,?,?,?,?,?,?)`).run(id,shop.id,`OM-${String(ordinal).padStart(6,'0')}`,requestId,v.buyer,shop.name,shop.description,v.shippingMethod,v.subtotal,v.discount,v.shipping,v.total,v.note,DATE,DATE);
    for(const [position,item] of v.items.entries())db.prepare('INSERT INTO order_items(id,order_id,shop_id,position,name_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)').run(newId(),id,shop.id,position,item.name,item.quantity,item.price,item.lineTotal);
    db.prepare('INSERT INTO order_payment_snapshots(order_id,shop_id,kind,payload,qr_asset_id) VALUES(?,?,?,?,?)').run(id,shop.id,input.payment.kind,JSON.stringify(input.payment),input.payment.qrAssetId);
    db.prepare('INSERT INTO creation_ledger(event_id,order_id,allocated_number,created_at) VALUES(?,?,?,?)').run(newId(),id,ordinal,DATE);
    db.prepare("INSERT INTO status_history(id,order_id,shop_id,axis,from_value,to_value,reason,recorded_at) VALUES(?,?,?,'order','draft','active','明確儲存建立訂單',?)").run(newId(),id,shop.id,DATE);
    db.prepare('UPDATE app_state SET created_count=created_count+1,order_number_seq=? WHERE id=1').run(ordinal);
    db.prepare('UPDATE drafts SET is_active=0 WHERE request_id=?').run(requestId);db.exec('COMMIT');return id;
  }catch(error){db.exec('ROLLBACK');throw error;}
}
