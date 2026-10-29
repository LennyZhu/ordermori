export const CATALOG_MIGRATION = { version: 7, sql: `
CREATE TABLE catalog_products (
 id TEXT PRIMARY KEY NOT NULL, shop_id TEXT NOT NULL REFERENCES shops(id),
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 unit_price_cents INTEGER NOT NULL CHECK(typeof(unit_price_cents)='integer' AND unit_price_cents>=0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX catalog_products_shop_name ON catalog_products(shop_id,name COLLATE NOCASE,id);
` };
