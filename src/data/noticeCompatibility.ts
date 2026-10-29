import { DomainError } from '../domain/model.ts';
import { NOTICE_SETTING_COLUMNS, NoticeStageError } from '../domain/noticeDiagnostics.ts';
import type { NoticeSchemaDiagnostic } from '../domain/noticeDiagnostics.ts';

export interface SchemaPort {
  all<T>(sql: string): Promise<T[]>;
  exec(sql: string): Promise<void>;
}
// Read-only, allowlisted structural metadata. Never inspect or return any rows.
export async function noticeSchemaDiagnostic(db: SchemaPort): Promise<NoticeSchemaDiagnostic> {
  const version = (await db.all<{ user_version: number }>('PRAGMA user_version'))[0]?.user_version;
  const names = new Set((await db.all<{ name: string }>('PRAGMA table_info(notice_preferences)')).map((c) => c.name));
  return { schemaVersion: Number.isSafeInteger(version) ? version : null, missingColumns: NOTICE_SETTING_COLUMNS.filter((name) => !names.has(name)) };
}
// Early development v3 installations may predate the explicit note snapshot.
// Add the column forwards; never derive public consent from the current order note.
export const NOTICE_COMPATIBILITY_MIGRATION = {
  version: 4, sql: '',
  async prepare(db: SchemaPort) {
    const columns = await db.all<{ name: string }>('PRAGMA table_info(notice_preferences)');
    const names = new Set(columns.map((c) => c.name));
    if (!['order_id', 'shop_id', 'template', 'locale', 'include_note', 'revision'].every((n) => names.has(n))) {
      throw new DomainError('notice_schema', '付款通知設定結構不完整，未重建或清除資料。請保留原檔並回報。');
    }
    if (!names.has('note_snapshot')) await db.exec("ALTER TABLE notice_preferences ADD COLUMN note_snapshot TEXT NOT NULL DEFAULT ''");
  },
};
// A database can already report v4 while retaining the early development table.
// v5 inspects its actual structure instead of replaying any historical migration.
export const NOTICE_SCHEMA_REPAIR_MIGRATION = {
  version: 5, sql: '',
  async prepare(db: SchemaPort) {
    let stage: 'schema-check' | 'migration' = 'schema-check';
    try {
      const schema = await noticeSchemaDiagnostic(db);
      if (schema.missingColumns.some((name) => name !== 'note_snapshot')) {
        throw new DomainError('notice_schema', '付款通知設定結構不完整，未重建或清除資料。請保留原檔並回報。');
      }
      stage = 'migration';
      if (schema.missingColumns.includes('note_snapshot')) await db.exec("ALTER TABLE notice_preferences ADD COLUMN note_snapshot TEXT NOT NULL DEFAULT ''");
    } catch (cause) { throw new NoticeStageError(stage, cause); }
  },
};
