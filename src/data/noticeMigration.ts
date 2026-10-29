export const NOTICE_MIGRATION = { version: 3, sql: `
CREATE TABLE notice_preferences (
 order_id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL,
 template TEXT NOT NULL CHECK(template IN ('editorial','soft')), locale TEXT NOT NULL CHECK(locale='zh-HK'),
 include_note INTEGER NOT NULL CHECK(include_note IN (0,1)), note_snapshot TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id)
);
CREATE TABLE notice_files (
 id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, shop_id TEXT NOT NULL,
 order_revision INTEGER NOT NULL, preferences_revision INTEGER NOT NULL,
 template TEXT NOT NULL CHECK(template IN ('editorial','soft')), relative_path TEXT NOT NULL UNIQUE,
 width INTEGER NOT NULL CHECK(width=1080), height INTEGER NOT NULL CHECK(height>0),
 byte_count INTEGER NOT NULL CHECK(byte_count>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 data_hash TEXT NOT NULL CHECK(length(data_hash)=64), created_at TEXT NOT NULL,
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id)
);
CREATE INDEX notice_files_order ON notice_files(order_id,created_at DESC);
CREATE TRIGGER notice_file_immutable BEFORE UPDATE ON notice_files
 BEGIN SELECT RAISE(ABORT,'notice file metadata is immutable'); END;
CREATE TRIGGER locked_notice_preferences BEFORE UPDATE ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'notice preferences are locked'); END;
CREATE TRIGGER locked_notice_preferences_insert BEFORE INSERT ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'notice preferences are locked'); END;
CREATE TRIGGER locked_notice_preferences_delete BEFORE DELETE ON notice_preferences
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'notice preferences are locked'); END;
` };
