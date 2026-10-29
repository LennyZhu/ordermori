export const PAYMENT_MIGRATION = { version: 2, sql: `
CREATE TABLE payment_assets (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id), kind TEXT NOT NULL CHECK(kind IN ('fps','payme')),
 relative_path TEXT NOT NULL UNIQUE, mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 byte_count INTEGER NOT NULL CHECK(byte_count>0), sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0), created_at TEXT NOT NULL,
 UNIQUE(id,shop_id,kind)
);
CREATE TABLE payment_methods (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id), kind TEXT NOT NULL CHECK(kind IN ('fps','payme','bank')),
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
 order_id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('fps','payme','bank')),
 payload TEXT NOT NULL CHECK(json_valid(payload)), qr_asset_id TEXT,
 FOREIGN KEY(order_id,shop_id) REFERENCES orders(id,shop_id),
 FOREIGN KEY(qr_asset_id,shop_id,kind) REFERENCES payment_assets(id,shop_id,kind),
 CHECK(kind!='bank' OR qr_asset_id IS NULL)
);
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
` };
