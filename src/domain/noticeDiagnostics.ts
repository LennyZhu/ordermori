import { DomainError } from './model.ts';
import type { NoticeTemplate } from './notice.ts';

export type NoticeStage = 'settings' | 'schema-check' | 'migration' | 'settings-read' | 'settings-write' | 'settings-transaction' | 'settings-commit' | 'file-list' | 'template-render' | 'layout' | 'asset' | 'capture' | 'png-validation' | 'temp-file' | 'preview-read' | 'save-file';
export const NOTICE_SETTING_COLUMNS = ['order_id', 'shop_id', 'template', 'locale', 'include_note', 'note_snapshot', 'revision'] as const;
export interface NoticeSchemaDiagnostic { schemaVersion: number | null; missingColumns: (typeof NOTICE_SETTING_COLUMNS[number])[] }
type DiagnosticTemplate = NoticeTemplate | null;
const messages: Record<NoticeStage, string> = {
  settings: '通知設定操作未完成，請重試；如再次失敗，請提供開發診斷。',
  'schema-check': '通知設定結構未能確認，未清除或重建資料。請提供開發診斷。',
  migration: '通知設定升級未完成，未清除原資料。請提供開發診斷。',
  'settings-read': '通知設定未能讀取，尚未開始繪製所選模板。請重試。',
  'settings-write': '通知設定未能寫入，尚未產生所選模板。請提供開發診斷。',
  'settings-transaction': '通知設定交易未能開始，請重試。',
  'settings-commit': '通知設定交易未能完成，請提供開發診斷。',
  'file-list': '本機 PNG 記錄未能讀取，未刪除歷史檔案。請重試。',
  'template-render': '此模板未能完成繪製，請重試並回報模板名稱。',
  layout: '通知佈局尚未完整就緒，請重試預覽。', asset: '收款圖片或模板裝飾未就緒，未產生 PNG。',
  capture: 'view-shot 未能擷取此通知，請重試並回報模板及商品項數。',
  'png-validation': 'PNG 完整性檢查失敗，未將此圖視為有效預覽。',
  'temp-file': '臨時 PNG 未能完整讀取，請重新產生。',
  'preview-read': '目前 PNG 預覽未能讀取，請重新產生。', 'save-file': 'PNG 未能保存到本機，原訂單及歷史圖片未變更。',
};
function technicalError(cause: unknown) {
  const messages: string[] = []; let current = cause; let sqliteCode: number | undefined;
  // Expo native errors may be wrapped or plain objects. Inspect messages only for
  // fixed classifications; never return their text, SQL, parameter values or paths.
  for (let depth = 0; depth < 3 && current; depth++) {
    if (typeof current === 'string') { messages.push(current); break; }
    if (typeof current !== 'object') break;
    const error = current as { message?: unknown; cause?: unknown; errcode?: unknown };
    if (typeof error.message === 'string') messages.push(error.message);
    if (typeof error.errcode === 'number' && Number.isInteger(error.errcode) && error.errcode > 0 && error.errcode <= 65535) sqliteCode = error.errcode;
    current = error.cause;
  }
  const message = messages.join('\n'); const match = /Error code (\d{1,5}):/i.exec(message);
  if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) sqliteCode = Number(match[1]);
  return { message, sqliteCode };
}
export function noticeDiagnostic(stage: NoticeStage, template: DiagnosticTemplate, cause: unknown) {
  let code = 'unknown'; const technical = technicalError(cause), message = technical.message;
  if (cause instanceof NoticeStageError) code = cause.diagnosticCode;
  else if (/(?:no such column|no column named)[\s:]*note_snapshot/i.test(message)) code = 'schema_note_snapshot_missing';
  else if (/no such table[^\n]*notice_preferences/i.test(message)) code = 'schema_preferences_missing';
  else if (/no such column|no column named/i.test(message)) code = 'schema_column_missing';
  else if (/no such table/i.test(message)) code = 'schema_table_missing';
  else if (/foreign key mismatch/i.test(message)) code = 'schema_foreign_key_mismatch';
  else if (/NOT NULL constraint failed/i.test(message)) code = 'sqlite_not_null';
  else if (/CHECK constraint failed/i.test(message)) code = 'sqlite_check';
  else if (/FOREIGN KEY constraint failed/i.test(message)) code = 'sqlite_foreign_key';
  else if (/UNIQUE constraint failed/i.test(message)) code = 'sqlite_unique';
  else if (/notice preferences are locked/i.test(message)) code = 'sqlite_notice_locked';
  else if (/database is locked|database is busy/i.test(message)) code = 'sqlite_busy';
  else if (/cannot start a transaction|no transaction is active|cannot rollback|cannot commit/i.test(message)) code = 'sqlite_transaction';
  else if (/bind|parameter.*(?:range|count)/i.test(message)) code = 'sqlite_binding';
  else if (/constraint failed/i.test(message)) code = 'sqlite_constraint';
  else if (cause instanceof DomainError && ['notice', 'notice_schema', 'png', 'render', 'conflict', 'locked', 'asset', 'stale_task'].includes(cause.code)) code = cause.code;
  else if (cause instanceof TypeError) code = 'type_error';
  else if (cause instanceof Error) code = 'native_error';
  const sqliteCode = cause instanceof NoticeStageError ? cause.sqliteCode : technical.sqliteCode;
  const schema = cause instanceof NoticeStageError ? cause.schema : undefined;
  const safeTemplate = template === 'soft' || template === 'editorial' ? template : null;
  return { stage, template: safeTemplate, code, ...(sqliteCode === undefined ? {} : { sqliteCode }), ...(schema ? { schemaVersion: schema.schemaVersion, missingColumns: [...schema.missingColumns] } : {}) };
}
export class NoticeStageError extends DomainError {
  stage: NoticeStage; diagnosticCode: string; reported = false;
  sqliteCode?: number; schema?: NoticeSchemaDiagnostic;
  constructor(stage: NoticeStage, cause: unknown) {
    super(cause instanceof DomainError ? cause.code : `notice_${stage}`, cause instanceof DomainError ? cause.message : messages[stage]);
    this.stage = stage;
    this.diagnosticCode = noticeDiagnostic(stage, 'editorial', cause).code;
    this.sqliteCode = cause instanceof NoticeStageError ? cause.sqliteCode : technicalError(cause).sqliteCode;
  }
}
export function noticeFailure(stage: NoticeStage, template: DiagnosticTemplate, cause: unknown, schema?: NoticeSchemaDiagnostic): NoticeStageError {
  const actualStage = cause instanceof NoticeStageError ? cause.stage : stage;
  const error = cause instanceof NoticeStageError ? cause : new NoticeStageError(actualStage, cause);
  if (schema) error.schema = schema;
  if (!error.reported && typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[OrderMori PNG]', noticeDiagnostic(actualStage, template, error));
  error.reported = true; return error;
}
