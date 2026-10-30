import type { DatabasePort } from './store.ts';
import { DomainError, FREE_LIMIT } from '../domain/model.ts';
import { freeOrderPermission, hongKongMonth, nextHongKongMonth, validQuotaPeriod } from '../domain/quota.ts';
import type { MonthlyQuota } from '../domain/quota.ts';

// Caller owns the business DB transaction/maintenance lease. No separate
// device-settings write is involved in charging, advancing or restoring quota.
export async function monthlyQuota(db: DatabasePort, now: string): Promise<MonthlyQuota> {
  const observed = hongKongMonth(now);
  const state = await db.first<{ started_at: string | null; highest_period: string | null }>('SELECT started_at,highest_period FROM quota_state WHERE id=1');
  if (!state || ((state.started_at === null) !== (state.highest_period === null)) || (state.started_at !== null && !Number.isFinite(Date.parse(state.started_at))) || (state.highest_period !== null && !validQuotaPeriod(state.highest_period))) throw new DomainError('quota_data', '月度額度記錄無效，未重設任何用量。');
  if (!state.highest_period && await db.first('SELECT request_id FROM quota_events WHERE period IS NOT NULL LIMIT 1')) throw new DomainError('quota_data', '月度額度記錄無效，未重設任何用量。');
  if (!state.highest_period) await db.run('UPDATE quota_state SET started_at=?,highest_period=? WHERE id=1', [now, observed]);
  else if (observed > state.highest_period) await db.run('UPDATE quota_state SET highest_period=? WHERE id=1', [observed]);
  const period = state.highest_period && state.highest_period > observed ? state.highest_period : observed;
  const used = (await db.first<{ n: number }>('SELECT count(*) AS n FROM quota_events WHERE period=?', [period]))!.n;
  const clockRollback = observed < period, permission = freeOrderPermission(used, clockRollback);
  return { period, used, limit: FREE_LIMIT, remaining: Math.max(0, FREE_LIMIT - used), clockRollback, canCreate: permission.allowed, nextResetAt: nextHongKongMonth(period) };
}
