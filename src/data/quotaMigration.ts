// Keep lifetime evidence intact. Pre-migration orders are never back-charged.
// No FK to orders: replacing/deleting orders must not refund their usage.
export const QUOTA_MIGRATION = { version: 9, sql: `
CREATE TABLE quota_state (
 id INTEGER PRIMARY KEY CHECK(id=1), started_at TEXT, highest_period TEXT,
 CHECK((started_at IS NULL AND highest_period IS NULL) OR
 (started_at IS NOT NULL AND highest_period IS NOT NULL AND length(highest_period)=7
 AND highest_period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(highest_period,1,4)>='1970'
 AND substr(highest_period,6,2) BETWEEN '01' AND '12'))
);
INSERT INTO quota_state(id) VALUES(1);
CREATE TABLE quota_events (
 request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)>0),
 order_id TEXT NOT NULL UNIQUE CHECK(length(order_id)>0),
 period TEXT CHECK(period IS NULL OR (length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'
 AND substr(period,1,4)>='1970' AND substr(period,6,2) BETWEEN '01' AND '12')),
 recorded_at TEXT NOT NULL
);
INSERT INTO quota_events(request_id,order_id,period,recorded_at)
 SELECT creation_request_id,id,NULL,created_at FROM orders;
CREATE INDEX quota_events_period ON quota_events(period);
CREATE TRIGGER quota_events_no_update BEFORE UPDATE ON quota_events BEGIN SELECT RAISE(ABORT,'quota evidence is immutable'); END;
CREATE TRIGGER quota_events_no_delete BEFORE DELETE ON quota_events BEGIN SELECT RAISE(ABORT,'quota evidence is retained'); END;
CREATE TRIGGER quota_state_no_delete BEFORE DELETE ON quota_state BEGIN SELECT RAISE(ABORT,'quota state is retained'); END;
CREATE TRIGGER quota_state_no_rewind BEFORE UPDATE ON quota_state
 WHEN OLD.started_at IS NOT NULL AND (NEW.started_at IS NOT OLD.started_at OR NEW.highest_period IS NULL OR NEW.highest_period<OLD.highest_period)
 BEGIN SELECT RAISE(ABORT,'quota period cannot rewind'); END;
` };
