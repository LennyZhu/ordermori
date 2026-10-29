import { DomainError, countChars } from './model.ts';

export const PAYMENT_KINDS = ['fps', 'payme', 'bank'] as const;
export type PaymentKind = typeof PAYMENT_KINDS[number];
export type QrState = 'none' | 'available' | 'missing' | 'invalid';
export type PaymentState = 'not_configured' | 'incomplete' | 'ready';
export interface PaymentInput {
  fpsType: 'id' | 'phone' | 'email'; fpsValue: string;
  bankName: string; accountName: string; accountNumber: string;
  qrAssetId: string | null; confirmed: boolean;
}
export interface PaymentSnapshot extends PaymentInput {
  version: 1; methodId: string; shopId: string; kind: PaymentKind; revision: number;
  confirmedAt: string | null;
}
export interface PaymentMethod extends PaymentSnapshot {
  updatedAt: string; qrState: QrState; status: PaymentState;
}
export interface PaymentAsset {
  id: string; shopId: string; kind: 'fps' | 'payme'; relativePath: string;
  mime: 'image/png' | 'image/jpeg'; bytes: number; sha256: string; width: number; height: number;
}
export interface PaymentSettings { methods: PaymentMethod[]; defaultMethodId: string | null }
export interface PaymentChoice { snapshot: PaymentSnapshot; asset: PaymentAsset | null; qrState: QrState; status: PaymentState }
export const paymentName: Record<PaymentKind, string> = { fps: 'FPS 轉數快', payme: 'PayMe', bank: '銀行轉帳' };
export const paymentStatusText: Record<PaymentState, string> = { not_configured: '未設定', incomplete: '未完成', ready: '已設定' };
export function emptyPayment(): PaymentInput {
  return { fpsType: 'id', fpsValue: '', bankName: '', accountName: '', accountNumber: '', qrAssetId: null, confirmed: false };
}
export function isPaymentKind(value: unknown): value is PaymentKind { return PAYMENT_KINDS.includes(value as PaymentKind); }
export function normalizePayment(kind: PaymentKind, input: PaymentInput): PaymentInput {
  if (!isPaymentKind(kind) || !input || !['id', 'phone', 'email'].includes(input.fpsType) || typeof input.confirmed !== 'boolean') throw new DomainError('payment', '收款資料格式不支援，未變更資料。');
  for (const key of ['fpsValue', 'bankName', 'accountName', 'accountNumber'] as const) {
    if (typeof input[key] !== 'string' || countChars(input[key]) > (key === 'accountNumber' ? 80 : 120) || /[\x00-\x1f]/.test(input[key])) {
      throw new DomainError('payment', '請縮短收款資料並移除換行或控制字元。');
    }
  }
  if (input.qrAssetId !== null && (typeof input.qrAssetId !== 'string' || !input.qrAssetId || input.qrAssetId.length > 100)) throw new DomainError('payment', '收款圖片記錄不完整。');
  if (kind === 'bank' && input.qrAssetId) throw new DomainError('payment', '銀行轉帳使用文字資料，不接受收款圖片。');
  return { fpsType: kind === 'fps' ? input.fpsType : 'id', fpsValue: kind === 'fps' ? input.fpsValue.trim() : '',
    bankName: kind === 'bank' ? input.bankName.trim() : '', accountName: kind === 'bank' ? input.accountName.trim() : '',
    accountNumber: kind === 'bank' ? input.accountNumber.trim() : '', qrAssetId: input.qrAssetId, confirmed: input.confirmed };
}
export function paymentStatus(kind: PaymentKind, input: PaymentInput, qrState: QrState): PaymentState {
  const any = !!(input.fpsValue.trim() || input.bankName.trim() || input.accountName.trim() || input.accountNumber.trim() || input.qrAssetId);
  if (!any) return 'not_configured';
  if (!input.confirmed || (input.qrAssetId && qrState !== 'available')) return 'incomplete';
  if (kind === 'bank') return input.bankName.trim() && input.accountName.trim() && input.accountNumber.trim() ? 'ready' : 'incomplete';
  if (kind === 'payme') return input.qrAssetId && qrState === 'available' ? 'ready' : 'incomplete';
  // Syntactic checks only; the merchant confirms the actual registered account.
  const value = input.fpsValue.trim();
  const validText = validFpsIdentifier(input.fpsType, value);
  if (value && !validText) return 'incomplete';
  return validText || (input.qrAssetId && qrState === 'available') ? 'ready' : 'incomplete';
}
export function validFpsIdentifier(type: PaymentInput['fpsType'], value: string): boolean {
  // HKICL: https://fps.hkicl.com.hk/chi/fps/consumers/frequently_asked_questions.php (Q10)
  return type === 'id' ? /^(?:\d{7}|\d{9})$/.test(value.trim()) : type === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    : /^\+?[\d ()-]+$/.test(value.trim()) && value.replace(/\D/g, '').length >= 6 && value.replace(/\D/g, '').length <= 20;
}
export function paymentIssues(kind: PaymentKind, input: PaymentInput, qrState: QrState): string[] {
  const issues: string[] = [];
  if (input.qrAssetId && qrState !== 'available') issues.push('請重新匯入可讀取的官方圖片，或明確移除此圖片。');
  if (kind === 'fps' && input.fpsValue.trim() && !validFpsIdentifier(input.fpsType, input.fpsValue)) {
    issues.push(input.fpsType === 'id' ? 'FPS ID 應為 7 或 9 位數字。' : input.fpsType === 'email' ? '請檢查電郵格式。' : '請檢查電話格式，並核對是否已關聯 FPS。');
  }
  if (kind === 'fps' && !input.fpsValue.trim() && !input.qrAssetId) issues.push('請填寫一種 FPS 標識或匯入官方收款碼。');
  if (kind === 'payme' && !input.qrAssetId) issues.push('請匯入 PayMe 官方收款碼。');
  if (kind === 'bank' && !(input.bankName.trim() && input.accountName.trim() && input.accountNumber.trim())) issues.push('請補齊銀行名稱、收款人姓名及帳號。');
  if (!input.confirmed) issues.push('請核對資料後勾選商家確認。');
  return issues;
}
export function snapshotOf(method: PaymentSnapshot): PaymentSnapshot {
  return { version: 1, methodId: method.methodId, shopId: method.shopId, kind: method.kind, revision: method.revision,
    ...normalizePayment(method.kind, method), confirmedAt: method.confirmedAt };
}
export function paymentSummary(input: PaymentSnapshot): string {
  if (input.kind === 'bank') return [input.bankName, input.accountName, input.accountNumber].filter(Boolean).join(' · ') || '尚未填寫銀行資料';
  if (input.kind === 'payme') return input.qrAssetId ? '商家上載的官方收款碼' : '尚未上載官方收款碼';
  return input.fpsValue || (input.qrAssetId ? '商家上載的官方收款碼' : '尚未填寫收款資料');
}
