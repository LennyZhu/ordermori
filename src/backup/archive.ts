import { Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { DomainError } from '../domain/model.ts';
import { pngCrc } from '../domain/noticePixels.ts';

export const LIMITS = { files: 512, total: 256 * 1024 * 1024, file: 64 * 1024 * 1024, database: 32 * 1024 * 1024, manifest: 512 * 1024, rows: 50000 } as const;
export const CHUNK = 64 * 1024;
export interface ByteSource { size: number; read(offset: number, length: number): Promise<Uint8Array> }
export interface ByteSink { write(bytes: Uint8Array): Promise<void> }
export interface ArchiveEntry { path: string; size: number; offset: number; crc: number }
export const failBackup = (message: string): never => { throw new DomainError('backup', message); };
export function safeArchivePath(path: string) {
  if (path !== 'manifest.json' && path !== 'data.sqlite' && !/^media\/(payment-assets\/[a-f0-9-]{36}\.(png|jpg)|payment-notices\/[a-f0-9-]{36}\.png)$/.test(path)) {
    failBackup('備份包含不支援的路徑或檔案，未還原。');
  }
  return path;
}
async function read(source: ByteSource, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > source.size) failBackup('備份結構不完整。');
  const bytes = await source.read(offset, length);
  if (bytes.length !== length) failBackup('備份讀取未完成。');
  return bytes;
}
const dv = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
// v1 deliberately accepts only STORE ZIP entries emitted by our writer. No
// decompression/bombs, ZIP64, encryption, extra fields, symlinks or custom SQL.
// Inspect every central AND local header before writing any extracted bytes.
export async function inspectArchive(source: ByteSource): Promise<ArchiveEntry[]> {
  if (source.size < 22 || source.size > LIMITS.total + LIMITS.files * 512) failBackup('備份大小超出支援範圍（最多 256 MB）。');
  const end = dv(await read(source, source.size - 22, 22));
  const count = end.getUint16(10, true), directorySize = end.getUint32(12, true), directoryOffset = end.getUint32(16, true);
  if (end.getUint32(0, true) !== 0x06054b50 || end.getUint16(4, true) || end.getUint16(6, true) || end.getUint16(8, true) !== count || end.getUint16(20, true) || !count || count > LIMITS.files || directoryOffset + directorySize !== source.size - 22) failBackup('備份 ZIP 目錄無效或版本不支援。');
  const entries: ArchiveEntry[] = [], names = new Set<string>();
  let at = directoryOffset, expectedLocal = 0, total = 0;
  for (let i = 0; i < count; i++) {
    const c = dv(await read(source, at, 46));
    const flags = c.getUint16(8, true), size = c.getUint32(24, true), compressed = c.getUint32(20, true), nameLength = c.getUint16(28, true), localAt = c.getUint32(42, true), crc = c.getUint32(16, true);
    if (c.getUint32(0, true) !== 0x02014b50 || c.getUint16(6, true) > 20 || flags & ~0x808 || c.getUint16(10, true) !== 0 || compressed !== size || size > LIMITS.file || !nameLength || nameLength > 150 || c.getUint16(30, true) || c.getUint16(32, true) || c.getUint16(34, true) || ((c.getUint32(38, true) >>> 16) & 0xf000) === 0xa000 || localAt !== expectedLocal) failBackup('備份含不支援的壓縮、連結或重複／異常條目。');
    const nameBytes = await read(source, at + 46, nameLength);
    // Our names are ASCII. Do not accept alternate encodings/Unicode aliases.
    if (nameBytes.some(b => b < 32 || b > 126)) failBackup('備份檔名無效。');
    const path = safeArchivePath(strFromU8(nameBytes));
    if (names.has(path)) failBackup('備份含重複檔案。');
    names.add(path); total += size;
    if (total > LIMITS.total || (path === 'manifest.json' && size > LIMITS.manifest) || (path === 'data.sqlite' && size > LIMITS.database)) failBackup('備份內容超出安全大小限制。');
    const l = dv(await read(source, localAt, 30));
    if (l.getUint32(0, true) !== 0x04034b50 || l.getUint16(6, true) !== flags || l.getUint16(8, true) !== 0 || l.getUint16(26, true) !== nameLength || l.getUint16(28, true) || strFromU8(await read(source, localAt + 30, nameLength)) !== path) failBackup('備份本機條目與目錄不符。');
    const offset = localAt + 30 + nameLength;
    expectedLocal = offset + size;
    if (flags & 8) {
      const d = dv(await read(source, expectedLocal, 16));
      if (d.getUint32(0, true) !== 0x08074b50 || d.getUint32(4, true) !== crc || d.getUint32(8, true) !== size || d.getUint32(12, true) !== size) failBackup('備份檔案描述不完整。');
      expectedLocal += 16;
    } else if (l.getUint32(14, true) !== crc || l.getUint32(18, true) !== size || l.getUint32(22, true) !== size) failBackup('備份檔案大小不符。');
    if (expectedLocal > directoryOffset) failBackup('備份條目重疊。');
    entries.push({ path, size, offset, crc }); at += 46 + nameLength;
  }
  if (at !== directoryOffset + directorySize || expectedLocal !== directoryOffset || !names.has('manifest.json') || !names.has('data.sqlite')) failBackup('備份缺少清單或資料庫。');
  return entries;
}
export async function copyEntry(source: ByteSource, entry: ArchiveEntry, sink: ByteSink) {
  let crc = 0xffffffff;
  for (let offset = 0; offset < entry.size; offset += CHUNK) {
    const bytes = await read(source, entry.offset + offset, Math.min(CHUNK, entry.size - offset));
    crc = pngCrc(bytes, crc); await sink.write(bytes);
  }
  if (((crc ^ 0xffffffff) >>> 0) !== entry.crc) failBackup('備份檔案校驗失敗，未還原。');
}
export async function writeArchive(files: { path: string; source: ByteSource }[], sink: ByteSink) {
  let pending = Promise.resolve(); let failure: unknown;
  const zip = new Zip((error, data) => { if (error) failure = error; if (data) pending = pending.then(() => sink.write(data)); });
  for (const { path, source } of files) {
    safeArchivePath(path);
    const entry = new ZipPassThrough(path); zip.add(entry);
    for (let at = 0; at < source.size; at += CHUNK) { entry.push(await read(source, at, Math.min(CHUNK, source.size - at))); await pending; }
    entry.push(new Uint8Array(), true); await pending;
    if (failure) throw failure;
  }
  zip.end(); await pending; if (failure) throw failure;
}
export function textSource(text: string): ByteSource {
  const bytes = strToU8(text); return { size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) };
}
