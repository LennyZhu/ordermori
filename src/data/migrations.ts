import { PAYMENT_MIGRATION } from './paymentMigration.ts';
import { NOTICE_MIGRATION } from './noticeMigration.ts';
import { NOTICE_COMPATIBILITY_MIGRATION, NOTICE_SCHEMA_REPAIR_MIGRATION } from './noticeCompatibility.ts';
import type { SchemaPort } from './noticeCompatibility.ts';

export const SCHEMA_VERSION = 5;
interface Migration { version: number; sql: string; prepare?: (db: SchemaPort) => Promise<void> }
export const MIGRATIONS: Migration[] = [{ version: 1, sql: `
CREATE TABLE shops (
 id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE app_state (
 id INTEGER PRIMARY KEY CHECK(id=1), profile_id TEXT NOT NULL UNIQUE,
 active_shop_id TEXT NOT NULL REFERENCES shops(id), locale TEXT NOT NULL DEFAULT 'zh-HK',
 created_count INTEGER NOT NULL DEFAULT 0 CHECK(created_count>=0),
 order_number_seq INTEGER NOT NULL DEFAULT 0 CHECK(order_number_seq>=created_count)
);
CREATE TABLE orders (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id),
 order_number TEXT NOT NULL UNIQUE, creation_request_id TEXT NOT NULL UNIQUE,
 buyer_identifier TEXT NOT NULL CHECK(length(trim(buyer_identifier))>0),
 shop_name_snapshot TEXT NOT NULL, shop_description_snapshot TEXT NOT NULL,
 order_status TEXT NOT NULL CHECK(order_status IN ('active','cancelled')),
 payment_status TEXT NOT NULL CHECK(payment_status IN ('unpaid','paid','refunded')),
 fulfillment_status TEXT NOT NULL CHECK(fulfillment_status IN ('pending','shipped','handed_over')),
 currency TEXT NOT NULL DEFAULT 'HKD' CHECK(currency='HKD'),
 shipping_method TEXT NOT NULL CHECK(shipping_method IN ('included','sf_collect','pickup','custom')),
 subtotal_cents INTEGER NOT NULL CHECK(typeof(subtotal_cents)='integer' AND subtotal_cents>=0),
 discount_cents INTEGER NOT NULL CHECK(typeof(discount_cents)='integer' AND discount_cents>=0 AND discount_cents<=subtotal_cents),
 shipping_cents INTEGER NOT NULL CHECK(typeof(shipping_cents)='integer' AND shipping_cents>=0),
 total_cents INTEGER NOT NULL CHECK(typeof(total_cents)='integer' AND total_cents>0 AND total_cents=subtotal_cents-discount_cents+shipping_cents),
 note TEXT NOT NULL, financial_locked_at TEXT, paid_at TEXT, refunded_at TEXT, refunded_amount_cents INTEGER,
 fulfilled_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 UNIQUE(id,shop_id),
 CHECK(shipping_method='custom' OR shipping_cents=0),
 CHECK(payment_status='unpaid' OR financial_locked_at IS NOT NULL),
 CHECK(payment_status!='refunded' OR (refunded_at IS NOT NULL AND refunded_amount_cents=total_cents)),
 CHECK(order_status!='cancelled' OR (fulfillment_status='pending' AND payment_status IN ('unpaid','refunded'))),
 CHECK(fulfillment_status='pending' OR (financial_locked_at IS NOT NULL AND payment_status IN ('paid','refunded'))),
 CHECK(fulfillment_status!='handed_over' OR shipping_method='pickup'),
 CHECK(fulfillment_status!='shipped' OR shipping_method!='pickup')
);
CREATE TABLE order_items (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, shop_id TEXT NOT NULL,
 position INTEGER NOT NULL CHECK(position>=0), name_snapshot TEXT NOT NULL CHECK(length(trim(name_snapshot))>0),
 quantity INTEGER NOT NULL CHECK(typeof(quantity)='integer' AND quantity BETWEEN 1 AND 999),
 unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents)='integer' AND unit_price_cents>=0),
 line_total_cents INTEGER NOT NULL CHECK(typeof(line_total_cents)='integer' AND line_total_cents=unit_price_cents*quantity),
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id), UNIQUE(order_id,position)
);
CREATE TABLE drafts (
 id INTEGER PRIMARY KEY CHECK(id=1), shop_id TEXT NOT NULL REFERENCES shops(id), request_id TEXT NOT NULL,
 edit_seq INTEGER NOT NULL DEFAULT 0 CHECK(edit_seq>=0), payload TEXT NOT NULL CHECK(json_valid(payload)),
 is_active INTEGER NOT NULL CHECK(is_active IN (0,1)), updated_at TEXT NOT NULL
);
CREATE TABLE status_history (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, shop_id TEXT NOT NULL,
 axis TEXT NOT NULL CHECK(axis IN ('order','payment','fulfillment')),
 from_value TEXT NOT NULL, to_value TEXT NOT NULL, reason TEXT NOT NULL, recorded_at TEXT NOT NULL,
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id)
);
CREATE TABLE creation_ledger (
 event_id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
 allocated_number INTEGER NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX orders_shop_created ON orders(shop_id,created_at DESC,order_number DESC);
CREATE INDEX orders_shop_status ON orders(shop_id,order_status,payment_status,fulfillment_status);
CREATE INDEX history_order_time ON status_history(order_id,recorded_at);
CREATE TRIGGER counter_no_rewind BEFORE UPDATE ON app_state
 WHEN NEW.created_count<OLD.created_count OR NEW.order_number_seq<OLD.order_number_seq
 BEGIN SELECT RAISE(ABORT,'creation counter cannot rewind'); END;
CREATE TRIGGER financial_lock_permanent BEFORE UPDATE ON orders
 WHEN OLD.financial_locked_at IS NOT NULL AND NEW.financial_locked_at IS NOT OLD.financial_locked_at
 BEGIN SELECT RAISE(ABORT,'financial lock is permanent'); END;
CREATE TRIGGER locked_order_snapshot BEFORE UPDATE ON orders
 WHEN (OLD.financial_locked_at IS NOT NULL OR OLD.order_status='cancelled' OR OLD.payment_status='refunded')
 AND (NEW.buyer_identifier!=OLD.buyer_identifier OR NEW.subtotal_cents!=OLD.subtotal_cents
 OR NEW.discount_cents!=OLD.discount_cents OR NEW.shipping_cents!=OLD.shipping_cents OR NEW.total_cents!=OLD.total_cents
 OR NEW.shipping_method!=OLD.shipping_method OR NEW.note!=OLD.note
 OR NEW.shop_name_snapshot!=OLD.shop_name_snapshot OR NEW.shop_description_snapshot!=OLD.shop_description_snapshot)
 BEGIN SELECT RAISE(ABORT,'order snapshot is locked'); END;
CREATE TRIGGER locked_items_insert BEFORE INSERT ON order_items
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND (financial_locked_at IS NOT NULL OR order_status='cancelled' OR payment_status='refunded'))
 BEGIN SELECT RAISE(ABORT,'items are locked'); END;
CREATE TRIGGER locked_items_update BEFORE UPDATE ON order_items
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND (financial_locked_at IS NOT NULL OR order_status='cancelled' OR payment_status='refunded'))
 OR EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND (financial_locked_at IS NOT NULL OR order_status='cancelled' OR payment_status='refunded'))
 BEGIN SELECT RAISE(ABORT,'items are locked'); END;
CREATE TRIGGER locked_items_delete BEFORE DELETE ON order_items
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND (financial_locked_at IS NOT NULL OR order_status='cancelled' OR payment_status='refunded'))
 BEGIN SELECT RAISE(ABORT,'items are locked'); END;
` }, PAYMENT_MIGRATION, NOTICE_MIGRATION, NOTICE_COMPATIBILITY_MIGRATION, NOTICE_SCHEMA_REPAIR_MIGRATION];
