import { failBackup, LIMITS, safeArchivePath } from './archive.ts';
import type { ArchiveEntry } from './archive.ts';
import type { BackupSummary } from './data.ts';
export interface ManifestFile { path: string; size: number; sha256: string }
export interface Manifest { format: 'OrderMori'; version: 1; createdAt: string; schemaVersion: number; summary: BackupSummary; files: ManifestFile[] }
export function parseManifest(text: string, entries: ArchiveEntry[]): Manifest {
  let m: Manifest;
  try { m = JSON.parse(text); } catch { return failBackup('備份 Manifest 無法讀取。'); }
  if (!m || m.format !== 'OrderMori' || m.version !== 1 || !Number.isFinite(Date.parse(m.createdAt)) || !Number.isInteger(m.schemaVersion) || !m.summary || !Array.isArray(m.files) || m.files.length !== entries.length - 1 || m.files.length >= LIMITS.files || Object.keys(m).some(k => !['format','version','createdAt','schemaVersion','summary','files'].includes(k))) failBackup('備份格式版本或 Manifest 不支援。');
  if (Object.keys(m.summary).some(k => !['orders','items','media','createdCount','profileId','schemaVersion','products','quotaPeriod','quotaUsed'].includes(k))) failBackup('備份摘要含不支援欄位。');
  const names = new Set<string>();
  for (const file of m.files) {
    if (!file || typeof file.path !== 'string') failBackup('備份清單無效。');
    safeArchivePath(file.path);
    const entry = entries.find(e => e.path === file.path);
    if (file.path === 'manifest.json' || names.has(file.path) || !entry || !Number.isSafeInteger(file.size) || file.size !== entry.size || !/^[a-f0-9]{64}$/.test(file.sha256) || Object.keys(file).some(k => !['path','size','sha256'].includes(k))) failBackup('備份清單與實際檔案不符。');
    names.add(file.path);
  }
  return m;
}
export function verifySummary(manifest: Manifest, summary: BackupSummary) {
  if (manifest.schemaVersion >= 9 && (manifest.summary.quotaPeriod !== summary.quotaPeriod || manifest.summary.quotaUsed !== summary.quotaUsed)) failBackup('備份月度額度摘要與資料庫不符。');
  // Format v1 is unchanged. v7 snapshots include a product count; v6 and older
  // legitimately omit it and migrate to an empty catalog on the staging copy.
  if ((manifest.schemaVersion >= 7 || manifest.summary.products !== undefined) && manifest.summary.products !== summary.products) failBackup('備份常用商品摘要與資料庫不符。');
  if (['orders','items','media','createdCount','profileId'].some(k => manifest.summary[k as keyof BackupSummary] !== summary[k as keyof BackupSummary])) failBackup('備份摘要與資料庫實際內容不符。');
}
