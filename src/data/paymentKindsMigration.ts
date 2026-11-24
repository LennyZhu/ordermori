// The caller wraps this migration in its existing transaction. Copy rows verbatim
// with foreign keys enabled. Install snapshot guards after copying locked history.
export const PAYMENT_KINDS_MIGRATION = { version: 11, sql: `
CREATE TEMP TABLE v11_payment_assets AS SELECT id,shop_id,kind,relative_path,mime,byte_count,sha256,width,height,created_at FROM main.payment_assets;
CREATE TEMP TABLE v11_payment_methods AS SELECT id,shop_id,kind,payload,qr_asset_id,revision,updated_at FROM main.payment_methods;
CREATE TEMP TABLE v11_order_payment_snapshots AS SELECT order_id,shop_id,kind,payload,qr_asset_id FROM main.order_payment_snapshots;
CREATE TEMP TABLE v11_shop_payment_defaults AS SELECT shop_id,method_id FROM main.shop_payment_defaults;
DROP TABLE main.shop_payment_defaults;
DROP TABLE main.order_payment_snapshots;
DROP TABLE main.payment_methods;
DROP TABLE main.payment_assets;
CREATE TABLE payment_assets (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id), kind TEXT NOT NULL CHECK(kind IN ('fps','payme','alipayhk','wechat_pay_hk')),
 relative_path TEXT NOT NULL UNIQUE, mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 byte_count INTEGER NOT NULL CHECK(byte_count>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0), created_at TEXT NOT NULL,
 UNIQUE(id,shop_id,kind)
);
CREATE TABLE payment_methods (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id), kind TEXT NOT NULL CHECK(kind IN ('fps','payme','alipayhk','wechat_pay_hk','bank')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), qr_asset_id TEXT, revision INTEGER NOT NULL CHECK(revision>0), updated_at TEXT NOT NULL,
 UNIQUE(shop_id,kind), UNIQUE(id,shop_id),
 CHECK(kind!='bank' OR qr_asset_id IS NULL),
 FOREIGN KEY(qr_asset_id,shop_id,kind) REFERENCES payment_assets(id,shop_id,kind)
);
CREATE TABLE shop_payment_defaults (
 shop_id TEXT PRIMARY KEY NOT NULL REFERENCES shops(id), method_id TEXT NOT NULL,
 FOREIGN KEY(method_id,shop_id) REFERENCES payment_methods(id,shop_id)
);
CREATE TABLE order_payment_snapshots (
 order_id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('fps','payme','alipayhk','wechat_pay_hk','bank')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), qr_asset_id TEXT,
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id),
 FOREIGN KEY(qr_asset_id,shop_id,kind) REFERENCES payment_assets(id,shop_id,kind),
 CHECK(kind!='bank' OR qr_asset_id IS NULL)
);
INSERT INTO payment_assets (id,shop_id,kind,relative_path,mime,byte_count,sha256,width,height,created_at)
 SELECT id,shop_id,kind,relative_path,mime,byte_count,sha256,width,height,created_at FROM temp.v11_payment_assets;
DROP TABLE temp.v11_payment_assets;
INSERT INTO payment_methods (id,shop_id,kind,payload,qr_asset_id,revision,updated_at)
 SELECT id,shop_id,kind,payload,qr_asset_id,revision,updated_at FROM temp.v11_payment_methods;
DROP TABLE temp.v11_payment_methods;
INSERT INTO order_payment_snapshots (order_id,shop_id,kind,payload,qr_asset_id)
 SELECT order_id,shop_id,kind,payload,qr_asset_id FROM temp.v11_order_payment_snapshots;
DROP TABLE temp.v11_order_payment_snapshots;
INSERT INTO shop_payment_defaults (shop_id,method_id)
 SELECT shop_id,method_id FROM temp.v11_shop_payment_defaults;
DROP TABLE temp.v11_shop_payment_defaults;
CREATE TRIGGER payment_asset_immutable BEFORE UPDATE ON payment_assets
 BEGIN SELECT RAISE(ABORT,'payment asset metadata is immutable'); END;
CREATE TRIGGER locked_payment_insert BEFORE INSERT ON order_payment_snapshots
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=NEW.order_id AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'payment snapshot is locked'); END;
CREATE TRIGGER locked_payment_update BEFORE UPDATE ON order_payment_snapshots
 WHEN EXISTS(SELECT 1 FROM orders WHERE id IN (OLD.order_id,NEW.order_id) AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'payment snapshot is locked'); END;
CREATE TRIGGER locked_payment_delete BEFORE DELETE ON order_payment_snapshots
 WHEN EXISTS(SELECT 1 FROM orders WHERE id=OLD.order_id AND (financial_locked_at IS NOT NULL OR order_status!='active' OR payment_status!='unpaid' OR fulfillment_status!='pending'))
 BEGIN SELECT RAISE(ABORT,'payment snapshot is locked'); END;
CREATE TEMP TABLE v11_foreign_key_guard (violations INTEGER CHECK(violations = 0));
INSERT INTO temp.v11_foreign_key_guard SELECT count(*) FROM pragma_foreign_key_check;
DROP TABLE temp.v11_foreign_key_guard;
` };
