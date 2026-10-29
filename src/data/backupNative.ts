import { Image, Platform } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { openDatabaseAsync } from 'expo-sqlite';
import { strFromU8 } from 'fflate';
import type { OrderStore } from './store';
import { databasePort, snapshotDatabase } from './native';
import { businessMediaRoot } from './mediaRoot';
import { CHUNK, copyEntry, failBackup, inspectArchive, LIMITS, textSource, writeArchive } from '../backup/archive';
import type { ByteSource } from '../backup/archive';
import { checkSchema, mediaReferences, migrateInspected, readBackupData, replaceData, validateData } from '../backup/data';
import type { BackupData, BackupSummary, MediaRef } from '../backup/data';
import { parseManifest, verifySummary } from '../backup/manifest';
import type { Manifest, ManifestFile } from '../backup/manifest';
import { DomainError } from '../domain/model';
import { verifyBackupMedia } from '../backup/media';
import { backupFileName, isBackupFileName, BACKUP_PICKER_OPTIONS, BACKUP_SHARE_OPTIONS } from '../backup/fileNames';
import type { SchemaDiagnostic } from '../backup/schemaDiagnostics';
const schemaLog = (stage: 'export-snapshot' | 'archive-inspect', report: SchemaDiagnostic) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[OrderMori Backup Schema]', { stage, ...report });
};

export interface BackupPreview { token: string; createdAt: string; summary: BackupSummary; bytes: number }
interface Candidate { archiveHash?: string; presented?: boolean; dir: Directory; manifest: Manifest; preview: BackupPreview }
const candidates = new Map<string, Candidate>();
const workRoot = () => new Directory(Paths.cache, 'ordermori-backup-work');
const unsupported = () => failBackup('目前只支援 iOS 本機備份與還原。');
async function workDirectory() { const dir = new Directory(workRoot(), randomUUID()); await dir.create({ intermediates: true }); return dir; }
const sourceOf = (file: File): ByteSource => ({ size: file.size, async read(offset, length) {
  const handle = file.open(FileMode.ReadOnly); try { handle.offset = offset; return await handle.readBytes(length); } finally { handle.close(); }
} });
async function createEmpty(file: File) { await file.parentDirectory.create({ intermediates: true, idempotent: true }); await file.create({ overwrite: false }); }
async function copyBytes(source: ByteSource, target: File) {
  await createEmpty(target); const handle = target.open(FileMode.WriteOnly);
  try { for (let at = 0; at < source.size; at += CHUNK) await handle.writeBytes(await source.read(at, Math.min(CHUNK, source.size - at))); }
  finally { handle.close(); }
}
function diskSpace(bytes: number) { if (Paths.availableDiskSpace < bytes + 32 * 1024 * 1024) failBackup('可用空間不足，未變更原資料。請騰出空間後重試。'); }
const reference = async () => { const db = await openDatabaseAsync(':memory:', { useNewConnection: true }); return { db: databasePort(db), close: () => db.closeAsync() }; };
async function checkMedia(base: Directory, refs: MediaRef[]) {
  await verifyBackupMedia(refs, {
    size: async path => { const file = new File(base,path); return file.exists ? file.size : null; },
    hash: path => new File(base,path).digest('SHA-256'),
    header: path => { const file = new File(base,path); return sourceOf(file).read(0,Math.min(24,file.size)); },
    dimensions: path => Image.getSize(new File(base,path).uri),
  });
}
async function loadData(dir: Directory, manifest?: Manifest): Promise<BackupData> {
  const raw = new File(dir, 'data.sqlite');
  if (!raw.exists || raw.size < 100 || raw.size > LIMITS.database || strFromU8(await sourceOf(raw).read(0,16)) !== 'SQLite format 3\0') failBackup('備份資料庫檔案無效。');
  if (manifest) {
    const record = manifest.files.find(f => f.path === 'data.sqlite');
    if (!record || raw.size !== record.size || await raw.digest('SHA-256') !== record.sha256) failBackup('備份資料庫 SHA-256 不符。');
  }
  // Never migrate the original imported snapshot; all migrations run on a copy.
  const copyDir = new Directory(dir, randomUUID()); await copyDir.create();
  const copy = new File(copyDir, 'validate.sqlite'); await raw.copy(copy, { overwrite: false });
  const database = await openDatabaseAsync('validate.sqlite', { useNewConnection: true }, copyDir.uri);
  try {
    const db = databasePort(database), version = await checkSchema(db, reference, report => schemaLog('archive-inspect',report));
    if (manifest && manifest.schemaVersion !== version) failBackup('Manifest 與資料庫版本不符。');
    await migrateInspected(db);
    const data = await readBackupData(db), summary = validateData(data), refs = mediaReferences(data);
    if (manifest) {
      verifySummary(manifest, summary);
      if (manifest.files.length !== refs.length + 1 || refs.some(r => !manifest.files.some(f => f.path === `media/${r.path}` && f.size === r.size && f.sha256 === r.sha256))) failBackup('資料庫圖片引用與備份清單不符。');
    }
    await checkMedia(new Directory(dir, 'media'), refs); return data;
  } finally { await database.closeAsync(); await copyDir.delete(); }
}
async function unpack(file: File, dir: Directory): Promise<Candidate> {
  const source = sourceOf(file), entries = await inspectArchive(source);
  diskSpace(entries.reduce((n,e) => n + e.size, 0) * 2);
  const chunks: Uint8Array[] = [];
  await copyEntry(source, entries.find(e => e.path === 'manifest.json')!, { write: async bytes => { chunks.push(bytes); } });
  const manifestBytes = new Uint8Array(chunks.reduce((n,b) => n + b.length,0)); let offset = 0;
  for (const chunk of chunks) { manifestBytes.set(chunk, offset); offset += chunk.length; }
  const manifest = parseManifest(strFromU8(manifestBytes), entries);
  for (const entry of entries.filter(e => e.path !== 'manifest.json')) {
    const target = new File(dir, entry.path); await createEmpty(target);
    const handle = target.open(FileMode.WriteOnly);
    try { await copyEntry(source, entry, { write: bytes => handle.writeBytes(bytes) }); } finally { handle.close(); }
    const expected = manifest.files.find(f => f.path === entry.path)!;
    if (target.size !== expected.size || await target.digest('SHA-256') !== expected.sha256) failBackup('備份 SHA-256 校驗失敗。');
  }
  const data = await loadData(dir, manifest);
  return { dir, manifest, preview: { token: randomUUID(), createdAt: manifest.createdAt, summary: validateData(data), bytes: file.size } };
}
export async function createBackup(store: OrderStore): Promise<BackupPreview> {
  if (Platform.OS !== 'ios') unsupported();
  const dir = await workDirectory();
  try {
    const result = await store.maintenance(async db => {
      diskSpace(64 * 1024 * 1024);
      const destination = await openDatabaseAsync('data.sqlite', { useNewConnection: true }, dir.uri);
      let data: BackupData;
      try {
        await snapshotDatabase(destination);
        await destination.execAsync("PRAGMA journal_mode=DELETE; UPDATE backup_state SET media_generation='',last_created_at=NULL WHERE id=1;");
        await checkSchema(databasePort(destination), reference, report => schemaLog('export-snapshot',report));
        data = await readBackupData(databasePort(destination));
      } finally { await destination.closeAsync(); }
      const refs = mediaReferences(data!); diskSpace(refs.reduce((n,r) => n+r.size,0)*2);
      // Immutable media is held by the store maintenance lease until copied.
      await checkMedia(businessMediaRoot(), refs);
      for (const ref of refs) await copyBytes(sourceOf(new File(businessMediaRoot(), ref.path)), new File(dir,'media',ref.path));
      await checkMedia(new Directory(dir,'media'), refs);
      const paths = ['data.sqlite', ...refs.map(r => `media/${r.path}`)], files: ManifestFile[] = [];
      for (const path of paths) { const file = new File(dir,path); files.push({ path, size: file.size, sha256: await file.digest('SHA-256') }); }
      const createdAt = new Date().toISOString(), summary = validateData(data!);
      const manifest: Manifest = { format: 'OrderMori', version: 1, createdAt, schemaVersion: summary.schemaVersion, summary, files };
      const archive = new File(dir, backupFileName(createdAt)); await createEmpty(archive);
      const handle = archive.open(FileMode.WriteOnly);
      try { await writeArchive([{ path:'manifest.json',source:textSource(JSON.stringify(manifest)) },...files.map(f => ({path:f.path, source:sourceOf(new File(dir,f.path))}))], {write:bytes => handle.writeBytes(bytes)}); } finally { handle.close(); }
      // Round-trip the actual generated archive before declaring local success.
      const verifyDir = await workDirectory(); let verified: Candidate;
      try { verified = await unpack(archive, verifyDir); } finally { await verifyDir.delete(); }
      const preview = { ...verified!.preview, token: randomUUID() };
      await db.run('UPDATE backup_state SET last_created_at=? WHERE id=1',[createdAt]);
      candidates.set(preview.token, { dir, manifest, preview, archiveHash: await archive.digest('SHA-256') });
      return preview;
    });
    return result;
  } catch (error) { if (dir.exists) await dir.delete(); throw readable(error); }
}
export async function chooseBackup(): Promise<BackupPreview | null> {
  if (Platform.OS !== 'ios') unsupported();
  let dir: Directory | undefined;
  try {
    const picker = await import('expo-document-picker').catch(() => { throw new DomainError('backup_build','此 Development Build 尚未包含檔案選擇器，請重新構建 App 後再試。'); });
    const result = await picker.getDocumentAsync(BACKUP_PICKER_OPTIONS);
    if (result.canceled) return null;
    const picked = result.assets[0];
    if (!picked?.uri.startsWith('file://') || !isBackupFileName(picked.name)) failBackup('請選擇 OrderMori 的 .ordermori 或 .ordermori.zip 備份檔案。');
    const input = new File(picked.uri);
    if (!input.exists || input.size > LIMITS.total + LIMITS.files * 512) failBackup('備份超過 256 MB 或無法讀取。');
    diskSpace(input.size*2);
    dir = await workDirectory(); const archive = new File(dir,'input.ordermori'); await copyBytes(sourceOf(input),archive);
    // The picker made this cache copy; never delete the original Files URL.
    if (input.uri.startsWith(new Directory(Paths.cache,'DocumentPicker').uri + '/')) {
      try { input.delete(); } catch { /* The system cache copy may remain until iOS reclaims it. */ }
    }
    const candidate = await unpack(archive,dir); candidates.set(candidate.preview.token,candidate); return candidate.preview;
  } catch (error) { if (dir?.exists) await dir.delete(); throw readable(error); }
}
export async function exportBackup(preview: BackupPreview) {
  const candidate = candidates.get(preview.token) ?? failBackup('備份暫存已失效，請重新建立。');
  const filename = backupFileName(candidate.manifest.createdAt);
  const file = new File(candidate.dir,filename);
  if (!file.exists || file.size !== candidate.preview.bytes || !candidate.archiveHash || await file.digest('SHA-256') !== candidate.archiveHash) failBackup('已建立的備份包遺失或校驗失敗，請重新建立。');
  const sharing = await import('expo-sharing');
  if (!await sharing.isAvailableAsync()) failBackup('系統檔案分享目前不可用，請稍後重試。');
  candidate.presented = true;
  await sharing.shareAsync(file.uri,BACKUP_SHARE_OPTIONS);
  return '系統面板已關閉。請確認你已選擇「儲存到檔案」並完成儲存；App 無法確認外部儲存結果。';
}
export async function restoreBackup(store: OrderStore, preview: BackupPreview) {
  const candidate = candidates.get(preview.token) ?? failBackup('備份預覽已失效，請重新選擇。');
  const generation = randomUUID(), target = new Directory(Paths.document,'ordermori','restored',generation);
  // Target is never deleted here, including ambiguous COMMIT errors. Old media
  // remains untouched. A committed DB is the sole authoritative root pointer.
  try {
    await store.maintenance(async db => {
      const data = await loadData(candidate.dir,candidate.manifest), refs = mediaReferences(data);
      diskSpace(refs.reduce((n,r) => n+r.size,0) + 2*LIMITS.database);
      await target.create({intermediates:true});
      for (const ref of refs) await copyBytes(sourceOf(new File(candidate.dir,'media',ref.path)),new File(target,ref.path));
      await checkMedia(target,refs);
      await replaceData(db,data,generation,randomUUID(),new Date().toISOString());
      store.retire();
    });
  } catch (error) { throw readable(error); }
}
export async function releaseBackup(preview: BackupPreview | null) {
  if (!preview) return; const candidate=candidates.get(preview.token); candidates.delete(preview.token);
  if (candidate?.dir.exists && !candidate.presented) await candidate.dir.delete();
}
export async function backupLastCreated(store: OrderStore) {
  return store.maintenance(async db => (await db.first<{ last_created_at:string | null }>('SELECT last_created_at FROM backup_state WHERE id=1'))?.last_created_at ?? null);
}
export function readable(error: unknown) {
  return error instanceof DomainError ? error : new DomainError('backup','本機備份或還原未能完成，未清除原資料。請檢查檔案及可用空間後重試。');
}

// Only our UUID cache folders, never documents, SQLite, official images or PNGs.
// Shared archives get a grace period; after a crash stale work is also reclaimed.
export async function cleanupBackupCache() {
  const root = workRoot(); if (!root.exists) return;
  const held = new Set([...candidates.values()].map(c => c.dir.uri));
  for (const item of await root.list()) {
    if (!(item instanceof Directory) || !/^[a-f0-9-]{36}$/.test(item.name) || held.has(item.uri)) continue;
    const info = await item.info();
    const modified = info.modificationTime ?? info.creationTime;
    if (modified && modified < Date.now() - 7*24*60*60*1000) await item.delete();
  }
}
