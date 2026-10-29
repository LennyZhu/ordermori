export interface SchemaEntry { type: string; name: string; tbl_name: string; sql: string | null }
export type SchemaRule = 'unexpected_object' | 'unexpected_internal_object' | 'missing_object' | 'owner_mismatch' | 'sql_mismatch' | 'duplicate_object' | 'schema_limit' | 'unsupported_version';
export interface SchemaDifference { type: string; name: string; tbl_name: string; rule: SchemaRule; reason: string }
export interface SchemaDiagnostic {
  schemaVersion: number;
  outcome: 'rejected' | 'legacy-compatible';
  reference: string;
  comparedWith: string;
  differenceCount: number;
  objects: SchemaDifference[];
}
const normalized = (sql: string | null) => sql === null ? null : sql.trim().replace(/\s+/g, ' ');
const key = (entry: SchemaEntry) => `${entry.type}:${entry.name}`;
const identifier = (text: string) => /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/.test(text) ? text : '[nonstandard identifier]';
function difference(entry: SchemaEntry, rule: SchemaRule, reason: string): SchemaDifference {
  return { type: ['table','index','view','trigger'].includes(entry.type) ? entry.type : '[unknown type]', name: identifier(entry.name), tbl_name: identifier(entry.tbl_name), rule, reason };
}
// No SQL or business rows enter diagnostics. Compare each object by identity,
// not sorted position; one missing trigger should not label later tables bad.
export function schemaDifferences(actual: SchemaEntry[], expected: SchemaEntry[]): SchemaDifference[] {
  const wanted = new Map(expected.map(entry => [key(entry),entry]));
  const seen = new Set<string>(), problems: SchemaDifference[] = [];
  for (const entry of actual) {
    const id = key(entry), other = wanted.get(id);
    if (seen.has(id)) problems.push(difference(entry,'duplicate_object','Object identity occurs more than once.'));
    seen.add(id);
    if (!other) problems.push(difference(entry,entry.name.startsWith('sqlite_') ? 'unexpected_internal_object' : 'unexpected_object','Object is not in this shipped schema variant.'));
    else if (entry.tbl_name !== other.tbl_name) problems.push(difference(entry,'owner_mismatch','Object belongs to a different table.'));
    else if (normalized(entry.sql) !== normalized(other.sql)) problems.push(difference(entry,'sql_mismatch','Definition differs from the shipped SQL; it was not executed.'));
  }
  for (const entry of expected) if (!seen.has(key(entry))) problems.push(difference(entry,'missing_object','Required object is absent in this schema variant.'));
  return problems;
}
export function schemaDiagnostic(schemaVersion: number, reference: string, objects: SchemaDifference[], outcome: SchemaDiagnostic['outcome'] = 'rejected', comparedWith = reference): SchemaDiagnostic {
  return { schemaVersion, outcome, reference, comparedWith, differenceCount: objects.length, objects: objects.slice(0,16) };
}
