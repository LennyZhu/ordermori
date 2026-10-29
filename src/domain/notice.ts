import { DomainError, countChars } from './model.ts';
import type { Order, OrderDetail } from './model.ts';
import { paymentIssues, paymentStatus, snapshotOf } from './payment.ts';
import type { PaymentAsset, PaymentChoice } from './payment.ts';

export const NOTICE_TEMPLATES = ['editorial', 'soft'] as const;
export type NoticeTemplate = typeof NOTICE_TEMPLATES[number];
export const templateName: Record<NoticeTemplate, string> = { editorial: '黑白極簡', soft: '韓系柔和' };
export interface NoticePreferences { template: NoticeTemplate; includeNote: boolean; noteSnapshot: string; locale: 'zh-HK'; revision: number }
export const defaultNoticePreferences = (): NoticePreferences => ({ template: 'editorial', includeNote: false, noteSnapshot: '', locale: 'zh-HK', revision: 0 });
export interface NoticeContext { detail: OrderDetail; payment: PaymentChoice | null; preferences: NoticePreferences }
export interface NoticeDocument {
  version: 1; orderId: string; shopId: string; orderRevision: number; preferencesRevision: number;
  template: NoticeTemplate; locale: 'zh-HK'; number: string; createdAt: string; shopName: string; shopDescription: string; buyer: string;
  items: { id: string; position: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number;
  shipping: Order['shipping_method']; shippingText: string; customerNote: string;
  payment: NonNullable<OrderDetail['payment']>; qr: PaymentAsset | null;
  // Both templates are Free. Future entitlement styling must not mutate this source snapshot.
  branding: 'Made with OrderMori';
}
export interface NoticeFileRecord {
  id: string; orderId: string; shopId: string; orderRevision: number; preferencesRevision: number;
  template: NoticeTemplate; relativePath: string; width: number; height: number; bytes: number; sha256: string; dataHash: string; createdAt: string;
}
export function noticeStateReason(order: Order): string | null {
  if (order.order_status !== 'active') return '已取消訂單不能產生新的付款通知。';
  if (order.payment_status !== 'unpaid') return '已付款或已退款訂單不能產生新的付款通知；已有檔案只供歷史查看。';
  if (order.fulfillment_status !== 'pending') return '已履約訂單不能再次產生付款請求。';
  return null;
}
export function noticeProblems(context: NoticeContext): string[] {
  const { detail, payment } = context; const problems: string[] = [];
  const state = noticeStateReason(detail.order); if (state) problems.push(state);
  if (!detail.order.shop_name_snapshot.trim()) problems.push('訂單尚未保存店舖名稱快照，請明確補齊後再產生。');
  if (context.preferences.includeNote && context.preferences.noteSnapshot !== detail.order.note) problems.push('訂單備註已改變，請重新確認客戶可見備註，或取消包含備註。');
  if (!detail.payment || !payment) problems.push('此訂單沒有收款快照，請修改訂單並明確選擇已確認的收款方式。');
  else if (paymentStatus(payment.snapshot.kind, payment.snapshot, payment.qrState) !== 'ready') {
    problems.push(...paymentIssues(payment.snapshot.kind, payment.snapshot, payment.qrState));
  }
  if (payment?.snapshot.confirmed && !Number.isFinite(Date.parse(payment.snapshot.confirmedAt ?? ''))) problems.push('收款快照缺少有效的商家確認紀錄，請明確重新選擇並儲存。');
  return problems;
}
export function buildNotice(context: NoticeContext): NoticeDocument {
  const problems = noticeProblems(context); if (problems.length) throw new DomainError('notice', problems.join('\n'));
  const { detail, preferences, payment } = context; const o = detail.order;
  if (!payment || !detail.payment || payment.snapshot.shopId !== o.shop_id || JSON.stringify(snapshotOf(detail.payment)) !== JSON.stringify(snapshotOf(payment.snapshot))) throw new DomainError('notice', '收款快照不一致，請重新開啟。');
  if (!NOTICE_TEMPLATES.includes(preferences.template) || preferences.locale !== 'zh-HK' || typeof preferences.includeNote !== 'boolean') throw new DomainError('notice', '付款通知設定不支援。');
  const items = [...detail.items].sort((a, b) => a.position - b.position);
  const cents = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!items.length || items.length > 20 || !o.buyer_identifier.trim() || !Number.isFinite(Date.parse(o.created_at)) ||
    items.some((i, n) => i.order_id !== o.id || i.shop_id !== o.shop_id || i.position !== n || !i.name_snapshot.trim() || countChars(i.name_snapshot) > 120 ||
      !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999 || !cents(i.unit_price_cents) || !cents(i.line_total_cents) || i.line_total_cents !== i.unit_price_cents * i.quantity) ||
    ![o.subtotal_cents, o.discount_cents, o.shipping_cents, o.total_cents].every(cents) || o.total_cents <= 0 || o.discount_cents > o.subtotal_cents ||
    items.reduce((sum, i) => sum + i.line_total_cents, 0) !== o.subtotal_cents || o.total_cents !== o.subtotal_cents - o.discount_cents + o.shipping_cents ||
    !['included', 'sf_collect', 'pickup', 'custom'].includes(o.shipping_method) || (o.shipping_method !== 'custom' && o.shipping_cents !== 0)) {
    throw new DomainError('notice', '已保存的商品或金額資料不一致，已停止輸出；不會重新計價或裁切內容。');
  }
  if (payment.snapshot.qrAssetId && (!payment.asset || payment.asset.id !== payment.snapshot.qrAssetId || payment.asset.shopId !== o.shop_id || payment.asset.kind !== payment.snapshot.kind || payment.qrState !== 'available')) throw new DomainError('notice', '原收款圖片不可用，不能換成店舖最新圖片。');
  return {
    version: 1, orderId: o.id, shopId: o.shop_id, orderRevision: o.revision, preferencesRevision: preferences.revision,
    template: preferences.template, locale: preferences.locale, number: o.order_number, createdAt: o.created_at,
    shopName: o.shop_name_snapshot, shopDescription: o.shop_description_snapshot, buyer: o.buyer_identifier,
    items: items.map((i) => ({ id: i.id, position: i.position, name: i.name_snapshot, quantity: i.quantity, unitCents: i.unit_price_cents, lineCents: i.line_total_cents })),
    subtotalCents: o.subtotal_cents, discountCents: o.discount_cents, shippingCents: o.shipping_cents, totalCents: o.total_cents,
    shipping: o.shipping_method, shippingText: { included: '包郵', sf_collect: '順豐運費到付 · 運費另付予順豐，不計入本單應付總額', pickup: '面交', custom: '自訂配送 · 運費由商家收取' }[o.shipping_method],
    customerNote: preferences.includeNote ? preferences.noteSnapshot : '', payment: snapshotOf(detail.payment), qr: payment.asset ? { ...payment.asset } : null, branding: 'Made with OrderMori',
  };
}
export const noticeSourceKey = (document: NoticeDocument): string => JSON.stringify(document);
export function noticeMoney(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new DomainError('notice', '金額必須為非負整數分。');
  return `HK$ ${Math.floor(cents / 100).toLocaleString('en-US')}.${String(cents % 100).padStart(2, '0')}`;
}
export function noticeDate(iso: string): string {
  const date = new Date(Date.parse(iso) + 8 * 3600000);
  return `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')} ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} HKT`;
}
export function noticeTextBlocks(d: NoticeDocument): Record<string, string> {
  const blocks: Record<string, string> = {
    shop: d.shopName, title: '付款通知 / Payment Notice', number: d.number, date: noticeDate(d.createdAt),
    thanks: 'Thank you', greeting: '感謝你的支持', buyerLabel: '買家', buyer: d.buyer,
    shippingLabel: '配送方式', shipping: d.shippingText,
    itemLabel: '商品', quantityLabel: '數量', unitLabel: '單價', lineLabel: '金額',
    subtotalLabel: '商品小計', subtotal: noticeMoney(d.subtotalCents), totalLabel: '應付總額', total: noticeMoney(d.totalCents),
    paymentTitle: d.payment.kind === 'fps' ? '請使用 FPS 轉數快付款' : d.payment.kind === 'payme' ? '請使用 PayMe 付款' : '銀行轉帳資料',
    reminder: '付款後請通知商家核對。',
    legal: '僅供付款通知，並非正式收據或已收款確認。App 不驗證到帳。', brand: d.branding,
  };
  if (d.shopDescription.trim()) blocks.description = d.shopDescription;
  if (d.discountCents > 0) { blocks.discountLabel = '固定折扣'; blocks.discount = `− ${noticeMoney(d.discountCents)}`; }
  if (d.shipping === 'custom') { blocks.deliveryLabel = '商家收取運費'; blocks.delivery = noticeMoney(d.shippingCents); }
  for (const [n, item] of d.items.entries()) {
    blocks[`item-${n}-serial`] = String(n + 1).padStart(2, '0'); blocks[`item-${n}-name`] = item.name;
    blocks[`item-${n}-quantity`] = String(item.quantity); blocks[`item-${n}-unit`] = noticeMoney(item.unitCents); blocks[`item-${n}-line`] = noticeMoney(item.lineCents);
  }
  if (d.customerNote) { blocks.noteLabel = '給客人的備註'; blocks.note = d.customerNote; }
  if (d.payment.kind === 'fps' && d.payment.fpsValue) {
    blocks.paymentLabel = { id: 'FPS ID', phone: '已關聯 FPS 的電話', email: '已關聯 FPS 的電郵' }[d.payment.fpsType]; blocks.paymentValue = d.payment.fpsValue;
  } else if (d.payment.kind === 'bank') {
    blocks.bankLabel = '銀行'; blocks.bank = d.payment.bankName; blocks.payeeLabel = '收款人'; blocks.payee = d.payment.accountName; blocks.accountLabel = '銀行帳號'; blocks.account = d.payment.accountNumber;
  }
  if (d.qr) { blocks.qrLabel = '商家提供的官方收款圖片'; blocks.qrReminder = '收款碼可能包含固定金額，請核對收款對象及本單金額是否適用。'; }
  return blocks;
}
