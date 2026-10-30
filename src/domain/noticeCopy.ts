import type { Shipping } from './model.ts';
export const NOTICE_LOCALES = ['zh-HK','en'] as const;
export type NoticeLocale = typeof NOTICE_LOCALES[number];
export const noticeLocaleName: Record<NoticeLocale,string> = { 'zh-HK':'繁體中文', en:'English' };
export const isNoticeLocale = (value: unknown): value is NoticeLocale => value === 'zh-HK' || value === 'en';
const zh = {
  title:'付款通知 / Payment Notice', thanks:'Thank you', greeting:'感謝你的支持', buyerLabel:'買家', shippingLabel:'配送方式',
  itemLabel:'商品', quantityLabel:'數量', unitLabel:'單價', lineLabel:'金額', subtotalLabel:'商品小計', totalLabel:'應付總額',
  fpsTitle:'請使用 FPS 轉數快付款', paymeTitle:'請使用 PayMe 付款', bankTitle:'銀行轉帳資料',
  reminder:'付款後請通知商家核對。', legal:'僅供付款通知，並非正式收據或已收款確認。App 不驗證到帳。',
  discountLabel:'固定折扣', deliveryLabel:'商家收取運費', noteLabel:'給客人的備註',
  fpsId:'FPS ID', fpsPhone:'已關聯 FPS 的電話', fpsEmail:'已關聯 FPS 的電郵',
  bankLabel:'銀行', payeeLabel:'收款人', accountLabel:'銀行帳號', qrLabel:'商家提供的官方收款圖片',
  qrReminder:'收款碼可能包含固定金額，請核對收款對象及本單金額是否適用。',
};
const en: Record<keyof typeof zh,string> = {
  title:'Payment Notice', thanks:'Thank you', greeting:'Thank you for your support', buyerLabel:'Buyer', shippingLabel:'Delivery',
  itemLabel:'Item', quantityLabel:'Qty', unitLabel:'Unit price', lineLabel:'Amount', subtotalLabel:'Subtotal', totalLabel:'Total due',
  fpsTitle:'Please pay by FPS', paymeTitle:'Please pay by PayMe', bankTitle:'Bank transfer details',
  reminder:'After payment, notify the shop so they can check it.', legal:'Payment notice only. Not a receipt or confirmation of payment. The app does not verify receipt of funds.',
  discountLabel:'Discount', deliveryLabel:'Shipping', noteLabel:'Note for the customer',
  fpsId:'FPS ID', fpsPhone:'Phone linked to FPS', fpsEmail:'Email linked to FPS',
  bankLabel:'Bank', payeeLabel:'Account holder', accountLabel:'Account number', qrLabel:'Official payment image supplied by the shop',
  qrReminder:'This code may include a fixed amount. Check the recipient and whether the code applies to this order’s total.',
};
export const noticeCopy = { 'zh-HK':zh, en };
const shippingCopy: Record<NoticeLocale,Record<Shipping,string>> = {
  'zh-HK':{ included:'包郵', sf_collect:'順豐運費到付 · 運費另付予順豐，不計入本單應付總額', pickup:'面交', custom:'自訂配送 · 運費由商家收取' },
  en:{ included:'Shipping included', sf_collect:'SF Express freight collect · Pay shipping to SF separately; excluded from this total', pickup:'In-person handover', custom:'Custom delivery · Shipping charged by the shop' },
};
export const noticeShippingText = (locale: NoticeLocale, shipping: Shipping) => shippingCopy[locale][shipping];
