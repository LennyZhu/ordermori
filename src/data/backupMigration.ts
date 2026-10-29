// Forward-only metadata for a committed media root and retained usage evidence.
export const BACKUP_MIGRATION = { version: 6, sql: `
CREATE TABLE restore_receipts (
 id TEXT PRIMARY KEY NOT NULL, source_profile_id TEXT NOT NULL,
 local_count INTEGER NOT NULL CHECK(local_count>=0), backup_count INTEGER NOT NULL CHECK(backup_count>=0),
 retained_count INTEGER NOT NULL CHECK(retained_count=max(local_count,backup_count)),
 number_seq INTEGER NOT NULL CHECK(number_seq>=retained_count), restored_at TEXT NOT NULL
);
CREATE TABLE backup_state (
 id INTEGER PRIMARY KEY CHECK(id=1), usage_receipt_id TEXT REFERENCES restore_receipts(id),
 media_generation TEXT NOT NULL DEFAULT '', last_created_at TEXT
);
INSERT INTO backup_state(id) VALUES(1);
` };
