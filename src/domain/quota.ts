import { DomainError, FREE_LIMIT } from './model.ts';

export const QUOTA_TIME_ZONE = 'Asia/Hong_Kong';
export const QUOTA_EXHAUSTED = '本月 15 張免費訂單已用完。下月將重新獲得 15 張額度；歷史訂單及草稿仍可使用。可了解 OrderMori Pro 永久解鎖。';
export const QUOTA_CLOCK_ERROR = '裝置時間早於已記錄月份，請校正時間後建立訂單；歷史訂單及草稿仍可使用。';
export interface MonthlyQuota {
  period: string; used: number; limit: number; remaining: number;
  clockRollback: boolean; nextResetAt: string; canCreate: boolean;
}
export const validQuotaPeriod = (value: unknown): value is string => typeof value === 'string' && /^(?:19[7-9]\d|[2-9]\d{3})-(?:0[1-9]|1[0-2])$/.test(value);
export function hongKongMonth(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new DomainError('quota_clock', '裝置時間無效，請校正時間後重試。');
  const parts = new Intl.DateTimeFormat('en', { timeZone: QUOTA_TIME_ZONE, year: 'numeric', month: '2-digit' }).formatToParts(date);
  const period = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
  if (!validQuotaPeriod(period)) throw new DomainError('quota_clock', '裝置時間無效，請校正時間後重試。');
  return period;
}
export function nextHongKongMonth(period: string): string {
  if (!validQuotaPeriod(period)) throw new DomainError('quota_clock', '月度額度記錄無效，未重設任何用量。');
  // Hong Kong uses UTC+08:00 with no current daylight-saving changes.
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1) - 8 * 3600000).toISOString();
}
// Free policy only. Phase 4D must use an Apple-verified entitlement provider;
// neither a local boolean nor a backup field can override this decision.
export function freeOrderPermission(used: number, clockRollback: boolean): { allowed: boolean; reason: string | null } {
  if (!Number.isSafeInteger(used) || used < 0) throw new DomainError('quota_data', '月度額度記錄無效，未重設任何用量。');
  return { allowed: !clockRollback && used < FREE_LIMIT, reason: clockRollback ? QUOTA_CLOCK_ERROR : used >= FREE_LIMIT ? QUOTA_EXHAUSTED : null };
}
export function quotaRefreshDelay(nextResetAt: string, now: number): number {
  return Math.min(60000, Math.max(100, Date.parse(nextResetAt) - now));
}
