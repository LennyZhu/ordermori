import { isNoticeLocale, noticeCopy, noticeShippingText } from './noticeCopy.ts';
import type { NoticeLocale } from './noticeCopy.ts';
import { DomainError, countChars, editable } from './model.ts';
import type { Order, OrderDetail } from './model.ts';
import { paymentIssues, paymentStatus, snapshotOf } from './payment.ts';
import type { PaymentAsset, PaymentChoice } from './payment.ts';
export { NOTICE_LOCALES, noticeLocaleName } from './noticeCopy.ts';
export type { NoticeLocale } from './noticeCopy.ts';

export const NOTICE_TEMPLATES = ['editorial', 'soft'] as const;
export type NoticeTemplate = typeof NOTICE_TEMPLATES[number];
export const templateName: Record<NoticeTemplate, string> = { editorial: '黑白極簡', soft: '韓系柔和' };
export interface NoticePreferences { template: NoticeTemplate; includeNote: boolean; noteSnapshot: string; locale: NoticeLocale; revision: number; removeBranding?: boolean }
export const defaultNoticePreferences = (): NoticePreferences => ({ template: 'editorial', includeNote: false, noteSnapshot: '', locale: 'zh-HK', revision: 0 });
export interface NoticeContext { detail: OrderDetail; payment: PaymentChoice | null; preferences: NoticePreferences; canRemoveBranding?: boolean }
export interface NoticeDocument {
  version: 1; orderId: string; shopId: string; orderRevision: number; preferencesRevision: number;
  template: NoticeTemplate; locale: NoticeLocale; number: string; createdAt: string; shopName: string; shopDescription: string; buyer: string;
  items: { id: string; position: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  subtotalCents: number; discountCents: number; shippingCents: number; totalCents: number;
  shipping: Order['shipping_method']; shippingText: string; customerNote: string;
  payment: NonNullable<OrderDetail['payment']>; qr: PaymentAsset | null;
  // Branding participates in the source identity. Runtime verified rights,
  // never a stored preference alone, may remove it from new documents.
  branding: '' | 'Made with OrderMori';
}
export interface NoticeFileRecord {
  id: string; orderId: string; shopId: string; orderRevision: number; preferencesRevision: number;
  template: NoticeTemplate; locale?: NoticeLocale; branding?: '' | 'Made with OrderMori'; relativePath: string; width: number; height: number; bytes: number; sha256: string; dataHash: string; createdAt: string;
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
  if (!NOTICE_TEMPLATES.includes(preferences.template) || !isNoticeLocale(preferences.locale) || typeof preferences.includeNote !== 'boolean') throw new DomainError('notice', '付款通知設定不支援。');
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
    shipping: o.shipping_method, shippingText: noticeShippingText(preferences.locale, o.shipping_method),
    customerNote: preferences.includeNote ? preferences.noteSnapshot : '', payment: snapshotOf(detail.payment), qr: payment.asset ? { ...payment.asset } : null, branding: preferences.removeBranding && context.canRemoveBranding ? '' : 'Made with OrderMori',
  };
}
// Missing locale is accepted only for pre-v8 in-memory file records. SQLite v8
// assigns zh-HK to every legacy file without changing its bytes or data hash.
export const noticeFileBranding = (file: Pick<NoticeFileRecord, 'branding'>) => file.branding ?? 'Made with OrderMori';
export const noticeFileLocale = (file: Pick<NoticeFileRecord,'locale'>): NoticeLocale => file.locale ?? 'zh-HK';
export function firstNoticeLocale(context: NoticeContext, files: readonly NoticeFileRecord[], appLocale: NoticeLocale): NoticeLocale {
  return context.preferences.revision === 0 && files.length === 0 && editable(context.detail.order) && !noticeStateReason(context.detail.order) ? appLocale : context.preferences.locale;
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
  const c = noticeCopy[d.locale];
  const blocks: Record<string, string> = {
    shop: d.shopName, title: c.title, number: d.locale === 'en' ? `Order no. ${d.number}` : d.number, date: noticeDate(d.createdAt),
    thanks: c.thanks, greeting: c.greeting, buyerLabel: c.buyerLabel, buyer: d.buyer,
    shippingLabel: c.shippingLabel, shipping: d.shippingText,
    itemLabel: c.itemLabel, quantityLabel: c.quantityLabel, unitLabel: c.unitLabel, lineLabel: c.lineLabel,
    subtotalLabel: c.subtotalLabel, subtotal: noticeMoney(d.subtotalCents), totalLabel: c.totalLabel, total: noticeMoney(d.totalCents),
    paymentTitle: d.payment.kind === 'fps' ? c.fpsTitle : d.payment.kind === 'payme' ? c.paymeTitle : c.bankTitle,
    reminder: c.reminder,
    legal: c.legal, brand: d.branding,
  };
  if (!d.branding) delete blocks.brand;
  if (d.shopDescription.trim()) blocks.description = d.shopDescription;
  if (d.discountCents > 0) { blocks.discountLabel = c.discountLabel; blocks.discount = `− ${noticeMoney(d.discountCents)}`; }
  if (d.shipping === 'custom') { blocks.deliveryLabel = c.deliveryLabel; blocks.delivery = noticeMoney(d.shippingCents); }
  for (const [n, item] of d.items.entries()) {
    blocks[`item-${n}-serial`] = String(n + 1).padStart(2, '0'); blocks[`item-${n}-name`] = item.name;
    blocks[`item-${n}-quantity`] = String(item.quantity); blocks[`item-${n}-unit`] = noticeMoney(item.unitCents); blocks[`item-${n}-line`] = noticeMoney(item.lineCents);
  }
  if (d.customerNote) { blocks.noteLabel = c.noteLabel; blocks.note = d.customerNote; }
  if (d.payment.kind === 'fps' && d.payment.fpsValue) {
    blocks.paymentLabel = { id: c.fpsId, phone: c.fpsPhone, email: c.fpsEmail }[d.payment.fpsType]; blocks.paymentValue = d.payment.fpsValue;
  } else if (d.payment.kind === 'bank') {
    blocks.bankLabel = c.bankLabel; blocks.bank = d.payment.bankName; blocks.payeeLabel = c.payeeLabel; blocks.payee = d.payment.accountName; blocks.accountLabel = c.accountLabel; blocks.account = d.payment.accountNumber;
  }
  if (d.qr) { blocks.qrLabel = c.qrLabel; blocks.qrReminder = c.qrReminder; }
  return blocks;
}
