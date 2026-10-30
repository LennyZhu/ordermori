import type { Row } from './data.ts';
import { failBackup } from './archive.ts';
import { hongKongMonth, validQuotaPeriod } from '../domain/quota.ts';

const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validateQuotaBackup(states: Row[], events: Row[], orders: Row[]) {
  const state = states[0];
  if (states.length !== 1 || state.id !== 1 || Object.keys(state).some(k => !['id','started_at','highest_period'].includes(k))) failBackup('備份月度額度記錄無效。');
  const initialized = state.started_at !== null || state.highest_period !== null;
  if (initialized && (!timestamp(state.started_at) || !validQuotaPeriod(state.highest_period) || hongKongMonth(state.started_at) > state.highest_period)) failBackup('備份月度額度記錄無效。');
  const highest = String(state.highest_period);
  const requests = new Set(), ids = new Set(), byId = new Map(orders.map(o => [o.id,o]));
  for (const e of events) {
    const order = byId.get(e.order_id);
    if (Object.keys(e).some(k => !['request_id','order_id','period','recorded_at'].includes(k)) || typeof e.request_id !== 'string' || !e.request_id || typeof e.order_id !== 'string' || !e.order_id ||
      requests.has(e.request_id) || ids.has(e.order_id) || !timestamp(e.recorded_at) ||
      (e.period !== null && (!initialized || !validQuotaPeriod(e.period) || e.period > highest || hongKongMonth(e.recorded_at) !== e.period)) ||
      (order && order.creation_request_id !== e.request_id)) failBackup('備份月度建立記錄無法校驗。');
    requests.add(e.request_id); ids.add(e.order_id);
  }
}
// Retain the union of known creation facts, including deleted/replaced orders.
// This is at least max(local, backup) for every month, and never double-charges
// the same request on repeated restore. Independent archive histories can be
// conservatively higher than either count alone. No Pro or device KV is read.
export function mergeQuotaEvidence(localState: Row, localEvents: Row[], incomingState: Row, incomingEvents: Row[], now: string) {
  const events = new Map(localEvents.map(e => [String(e.request_id),e]));
  const ids = new Map(localEvents.map(e => [String(e.order_id),String(e.request_id)]));
  for (const e of incomingEvents) {
    const old = events.get(String(e.request_id));
    if ((old && (['order_id','recorded_at'].some(k => old[k] !== e[k]) || (old.period !== null && e.period !== null && old.period !== e.period))) || (ids.has(String(e.order_id)) && ids.get(String(e.order_id)) !== e.request_id)) failBackup('本機與備份月度建立記錄衝突，未取代資料。');
    // A legacy identity is not charged. Never let an old snapshot downgrade a
    // monthly charge already known on this device (or vice versa).
    if (!old || old.period === null) events.set(String(e.request_id),e);
    ids.set(String(e.order_id),String(e.request_id));
  }
  const starts = [localState.started_at,incomingState.started_at].filter(timestamp);
  const started_at = starts.length ? starts.reduce((a,b) => Date.parse(a) <= Date.parse(b) ? a : b) : now;
  const highest_period = [hongKongMonth(now),localState.highest_period,incomingState.highest_period].filter(validQuotaPeriod).sort().at(-1)!;
  return { quota_state: [{ id:1,started_at,highest_period }], quota_events: [...events.values()] };
}
