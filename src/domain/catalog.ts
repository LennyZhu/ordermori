import { DomainError, countChars, parseCents } from './model.ts';
import type { OrderInput } from './model.ts';

export interface CatalogProduct {
  id: string; shop_id: string; name: string; unit_price_cents: number;
  revision: number; created_at: string; updated_at: string;
}
export interface ProductInput { name: string; price: string }
export function validProductValues(name: unknown, cents: unknown): boolean {
  return typeof name === 'string' && name === name.trim() && countChars(name) >= 1 && countChars(name) <= 120 &&
    !/[\x00-\x1f]/.test(name) && Number.isSafeInteger(cents) && Number(cents) >= 0;
}
export function normalizeProduct(input: ProductInput) {
  const name = input.name.trim(); const fields: Record<string,string> = {};
  if (!name || countChars(name) > 120 || /[\x00-\x1f]/.test(name)) fields.name = '請填寫 1 至 120 個字符的商品名稱，並移除換行。';
  let cents = 0;
  try { cents = parseCents(input.price); } catch { fields.price = '請輸入非負單價，最多兩位小數，並保持在安全金額範圍內。'; }
  if (Object.keys(fields).length) throw new DomainError('product_validation','請檢查商品名稱及單價。',fields);
  return { name, cents };
}
export function productPriceInput(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new DomainError('product_validation','商品單價無效。');
  return `${Math.floor(cents/100)}.${String(cents%100).padStart(2,'0')}`;
}
function pristinePlaceholder(input: OrderInput) {
  return input.items.length === 1 && !input.items[0].name.trim() && !input.items[0].price.trim() && input.items[0].quantity === '1';
}
export function productSlots(input: OrderInput) { return 20 - input.items.length + (pristinePlaceholder(input) ? 1 : 0); }
// Copy values, not a product ID or a live reference. Every selection gets a new
// row, including repeat selections. Existing user edits are never coalesced.
export function appendCatalogProduct(input: OrderInput, product: CatalogProduct, rowId: string): OrderInput {
  if (!validProductValues(product.name,product.unit_price_cents)) throw new DomainError('product_validation','商品資料無效，請重新選擇。');
  if (productSlots(input) <= 0) throw new DomainError('validation','每張訂單最多 20 項商品。');
  if (!rowId || input.items.some(item => item.id === rowId)) throw new DomainError('validation','商品行標識重複，請重試。');
  return { ...input, items: [...(pristinePlaceholder(input) ? [] : input.items), { id:rowId,name:product.name,price:productPriceInput(product.unit_price_cents),quantity:'1' }] };
}
