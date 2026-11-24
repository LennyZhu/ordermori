import type { PaymentSnapshot } from './payment.ts';

export const FREE_LIMIT = 15;
export const SHIPPING = ['included', 'sf_collect', 'pickup', 'custom'] as const;
export type Shipping = typeof SHIPPING[number];
export type OrderStatus = 'active' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'paid' | 'refunded';
export type FulfillmentStatus = 'pending' | 'shipped' | 'handed_over';
export type Action = 'mark_paid' | 'correct_payment' | 'fulfill' | 'refund' | 'cancel';
export type Filter = 'all' | 'unpaid' | 'fulfillment' | 'completed' | 'refunded' | 'cancelled';

export interface FormItem { id: string; name: string; price: string; quantity: string }
export interface OrderInput {
  buyer: string; items: FormItem[]; shipping: Shipping; shippingFee: string; discount: string; note: string;
  payment?: PaymentSnapshot | null; paymentChosen?: boolean;
}
export interface Shop { id: string; name: string; description: string; updated_at: string }
export interface Draft { requestId: string; shopId: string; editSeq: number; input: OrderInput }
export interface Order {
  id: string; shop_id: string; order_number: string; creation_request_id: string;
  buyer_identifier: string; shop_name_snapshot: string; shop_description_snapshot: string;
  order_status: OrderStatus; payment_status: PaymentStatus; fulfillment_status: FulfillmentStatus;
  shipping_method: Shipping; subtotal_cents: number; discount_cents: number;
  shipping_cents: number; total_cents: number; note: string;
  financial_locked_at: string | null; paid_at: string | null; refunded_at: string | null;
  refunded_amount_cents: number | null; fulfilled_at: string | null; cancelled_at: string | null;
  created_at: string; updated_at: string; revision: number;
}
export interface OrderItem {
  id: string; order_id: string; shop_id: string; position: number;
  name_snapshot: string; quantity: number; unit_price_cents: number; line_total_cents: number;
}
export interface History {
  id: string; order_id: string; shop_id: string; axis: 'order' | 'payment' | 'fulfillment';
  from_value: string; to_value: string; reason: string; recorded_at: string;
}
export interface OrderDetail { order: Order; items: OrderItem[]; history: History[]; payment: PaymentSnapshot | null; financialState?: FinancialState }
export interface HomeData {
  orders: Order[]; unpaid: number; fulfillment: number; createdCount: number; hasDraft: boolean; shop: Shop;
  quota: import('./quota.ts').MonthlyQuota;
}
export class DomainError extends Error {
  code: string;
  fields: Record<string, string>;
  constructor(code: string, message: string, fields: Record<string, string> = {}) {
    super(message); this.name = 'DomainError'; this.code = code; this.fields = fields;
  }
}
export function errorMessage(error: unknown) {
  return error instanceof DomainError ? error.message : '本機資料操作未能完成，請重試。資料不會因此自動清除。';
}
export const countChars = (text: string) => Array.from(text).length;
export function blankInput(itemId: string): OrderInput {
  return { buyer: '', items: [{ id: itemId, name: '', price: '', quantity: '1' }], shipping: 'included', shippingFee: '0', discount: '', note: '' };
}
export function parseCents(text: string): number {
  const value = text.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('請輸入非負金額，最多兩位小數。');
  const [whole, fraction = ''] = value.split('.');
  const dollars = Number(whole);
  const cents = dollars * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(dollars) || !Number.isSafeInteger(cents)) throw new Error('金額超出可安全計算的範圍。');
  return cents;
}
export function money(cents: number) {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `HK$${whole}.${String(cents % 100).padStart(2, '0')}`;
}
export function evaluate(input: OrderInput, strict = true) {
  const fields: Record<string, string> = {};
  const amount = (text: string, key: string, optional = false) => {
    try { return parseCents(optional && !text.trim() ? '0' : text); }
    catch (error) { fields[key] = (error as Error).message; return 0; }
  };
  if (strict && !input.buyer.trim()) fields.buyer = '請填寫 IG 用戶名、買家稱呼或客戶代號。';
  if (strict && countChars(input.buyer.trim()) > 120) fields.buyer = '買家標識最多 120 個字符。';
  if (input.items.length > 20 || (strict && input.items.length < 1)) fields.items = '每張訂單需有 1 至 20 項商品。';
  if (new Set(input.items.map((item) => item.id)).size !== input.items.length) fields.items = '商品標識重複，請重新開啟草稿。';
  let subtotal = 0;
  const items = input.items.map((item) => {
    const key = `item.${item.id}`;
    if (strict && !item.name.trim()) fields[`${key}.name`] = '請填寫商品名稱。';
    if (strict && countChars(item.name.trim()) > 120) fields[`${key}.name`] = '商品名稱最多 120 個字符，請自行調整，不會自動截斷。';
    const price = amount(item.price, `${key}.price`);
    const quantity = /^\d+$/.test(item.quantity.trim()) ? Number(item.quantity) : 0;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) fields[`${key}.quantity`] = '數量需為 1 至 999 的整數。';
    const lineTotal = price * quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) fields[`${key}.price`] = '商品金額超出安全範圍。';
    subtotal += lineTotal;
    return { name: item.name.trim(), quantity, price, lineTotal };
  });
  const discount = amount(input.discount, 'discount', true);
  const shipping = amount(input.shippingFee, 'shippingFee', true);
  if (!SHIPPING.includes(input.shipping)) fields.shippingFee = '請選擇有效配送方式。';
  if (input.shipping !== 'custom' && shipping !== 0) fields.shippingFee = '此配送方式的商家運費必須為 0。';
  if (discount > subtotal) fields.discount = '折扣不能超過商品小計，亦不能抵扣運費。';
  const total = subtotal - discount + shipping;
  if (!Number.isSafeInteger(total)) fields.total = '訂單總額超出安全範圍。';
  if (strict && total <= 0) fields.total = '正式訂單應付總額必須大於 0。';
  if (strict && countChars(input.note) > 500) fields.note = '訂單備註最多 500 個字符，請自行調整。';
  if (Object.keys(fields).length) throw new DomainError('validation', '請檢查並修正標示的欄位。', fields);
  return { buyer: input.buyer.trim(), items, subtotal, discount, shipping, total, shippingMethod: input.shipping, note: input.note };
}
export type FinancialState = 'never_paid' | 'locked' | 'inconsistent';
export const financialProtectionMessage = '訂單付款紀錄與永久財務鎖不一致，只可查看資料。';

// Payment events must be in insertion order. Device timestamps can tie or go backwards.
export function financialState(
  order: Pick<Order, 'id' | 'shop_id' | 'payment_status' | 'financial_locked_at' | 'paid_at' | 'refunded_at' | 'refunded_amount_cents' | 'total_cents'>,
  history: readonly Pick<History, 'order_id' | 'shop_id' | 'from_value' | 'to_value' | 'recorded_at'>[],
): FinancialState {
  let status: Order['payment_status'] = 'unpaid';
  let firstPaidAt: string | null = null, lastPaidAt: string | null = null, refundedAt: string | null = null;
  for (const event of history) {
    if (event.order_id !== order.id || event.shop_id !== order.shop_id || event.from_value !== status ||
        typeof event.recorded_at !== 'string' || !Number.isFinite(Date.parse(event.recorded_at))) return 'inconsistent';
    if (status === 'unpaid' && event.to_value === 'paid') {
      firstPaidAt ??= event.recorded_at;
      lastPaidAt = event.recorded_at;
    } else if (status === 'paid' && event.to_value === 'refunded') {
      refundedAt = event.recorded_at;
    } else if (!(status === 'paid' && event.to_value === 'unpaid')) {
      return 'inconsistent';
    }
    status = event.to_value;
  }
  if (order.payment_status !== status || order.financial_locked_at !== firstPaidAt ||
      order.paid_at !== lastPaidAt || order.refunded_at !== refundedAt ||
      order.refunded_amount_cents !== (status === 'refunded' ? order.total_cents : null)) return 'inconsistent';
  return firstPaidAt === null ? 'never_paid' : 'locked';
}

export function editable(order: Order, protection?: FinancialState) {
  return order.order_status === 'active' && order.payment_status === 'unpaid'
    && order.fulfillment_status === 'pending' && !order.financial_locked_at && !order.paid_at && !order.fulfilled_at && !order.refunded_at
    && (protection === undefined || protection === 'never_paid');
}
export function availableActions(order: Order): Action[] {
  if (order.order_status !== 'active') return [];
  const actions: Action[] = [];
  if (order.payment_status === 'unpaid' && order.fulfillment_status === 'pending') actions.push('mark_paid', 'cancel');
  if (order.payment_status === 'paid') {
    if (order.fulfillment_status === 'pending') {
      if (!order.refunded_at && !order.fulfilled_at) actions.push('correct_payment');
      actions.push('fulfill');
    }
    actions.push('refund');
  }
  if (order.payment_status === 'refunded' && order.fulfillment_status === 'pending') actions.push('cancel');
  return actions;
}
export function transition(order: Order, action: Action, reason: string, now: string) {
  if (!availableActions(order).includes(action)) throw new DomainError('state', '目前訂單狀態不允許此操作，請重新載入。');
  if ((action === 'correct_payment' || action === 'refund') && !reason.trim()) throw new DomainError('reason', '請填寫原因或退款說明。');
  if (countChars(reason) > 500) throw new DomainError('reason', '說明最多 500 個字符。');
  const next = { ...order, revision: order.revision + 1, updated_at: now };
  let axis: History['axis'] = 'order';
  let from = order.order_status as string;
  let to = 'cancelled';
  if (action === 'mark_paid') {
    axis = 'payment'; from = order.payment_status; to = 'paid';
    next.payment_status = 'paid'; next.paid_at = now;
    next.financial_locked_at = order.financial_locked_at ?? now;
  } else if (action === 'correct_payment') {
    axis = 'payment'; from = order.payment_status; to = 'unpaid'; next.payment_status = 'unpaid';
  } else if (action === 'refund') {
    axis = 'payment'; from = order.payment_status; to = 'refunded';
    next.payment_status = 'refunded'; next.refunded_at = now; next.refunded_amount_cents = order.total_cents;
  } else if (action === 'fulfill') {
    axis = 'fulfillment'; from = order.fulfillment_status;
    to = order.shipping_method === 'pickup' ? 'handed_over' : 'shipped';
    next.fulfillment_status = to as FulfillmentStatus; next.fulfilled_at = now;
  } else { next.order_status = 'cancelled'; next.cancelled_at = now; }
  return { next, axis, from, to };
}
export function toInput(detail: OrderDetail): OrderInput {
  const o = detail.order;
  const decimal = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  return { buyer: o.buyer_identifier, shipping: o.shipping_method, shippingFee: decimal(o.shipping_cents),
    discount: decimal(o.discount_cents), note: o.note, payment: detail.payment,
    items: detail.items.map((item) => ({ id: item.id, name: item.name_snapshot, price: decimal(item.unit_price_cents), quantity: String(item.quantity) })) };
}
