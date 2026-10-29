// The archive really is ZIP. Match its filename to the existing iOS ZIP UTI so
// Files does not need to append an extension to our custom .ordermori suffix.
export function backupFileName(createdAt: string) {
  return `OrderMori-Backup-${createdAt.slice(0,10).replaceAll('-','')}.ordermori.zip`;
}
// Initial identification only. Neither a suffix nor the provider's MIME type
// establishes trust; chooseBackup still runs the full archive/data validation.
export function isBackupFileName(name: string) {
  return /^[^/\\\x00-\x1f]+\.ordermori(?:\.zip)?$/i.test(name);
}
// public.item via */* keeps both the custom legacy extension and ZIP selectable,
// regardless of the Files provider's MIME classification.
export const BACKUP_PICKER_OPTIONS = { type: '*/*', copyToCacheDirectory: true, multiple: false } as const;
export const BACKUP_SHARE_OPTIONS = { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: '儲存 OrderMori 備份' } as const;
