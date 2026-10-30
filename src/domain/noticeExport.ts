import { DomainError } from './model.ts';
import { buildNotice, noticeSourceKey, noticeFileLocale } from './notice.ts';
import type { NoticeContext, NoticeDocument, NoticeFileRecord } from './notice.ts';

export type NoticeExportKind = 'share' | 'photos';
export interface NoticeExportStore {
  getNoticeContext(id: string): Promise<NoticeContext>;
  listNoticeFiles(id: string): Promise<NoticeFileRecord[]>;
}
const fileKey = (f: NoticeFileRecord) => JSON.stringify([f.id, f.orderId, f.shopId, f.orderRevision, f.preferencesRevision, f.template, noticeFileLocale(f), f.relativePath, f.width, f.height, f.bytes, f.sha256, f.dataHash, f.createdAt]);
export function assertNoticeExportCurrent(document: NoticeDocument, file: NoticeFileRecord, dataHash: string) {
  if (file.orderId !== document.orderId || file.shopId !== document.shopId || file.template !== document.template || noticeFileLocale(file) !== document.locale ||
    file.orderRevision !== document.orderRevision || file.preferencesRevision !== document.preferencesRevision || file.dataHash !== dataHash) {
    throw new DomainError('notice_export_stale', '此 PNG 的模板或訂單快照已過時，僅供歷史查看。請返回付款通知產生目前版本。');
  }
}
// All ports are read-only. Recheck current status, registration and source after
// asynchronous file verification; never use a historical PNG as a current request.
export async function prepareNoticeExport(store: NoticeExportStore, requested: NoticeFileRecord,
  digest: (text: string) => Promise<string>, verify: (file: NoticeFileRecord) => Promise<string>) {
  const registered = (await store.listNoticeFiles(requested.orderId)).find((f) => f.id === requested.id);
  if (!registered || fileKey(registered) !== fileKey(requested)) throw new DomainError('notice_export_file', '此 PNG 不再屬於目前訂單的本機記錄，未匯出。');
  const document = buildNotice(await store.getNoticeContext(registered.orderId));
  const source = noticeSourceKey(document);
  assertNoticeExportCurrent(document, registered, await digest(source));
  const uri = await verify(registered);
  if (!uri.startsWith('file://') || !uri.toLowerCase().endsWith('.png')) throw new DomainError('notice_export_file', '只可匯出已核對的本機 PNG 檔案。');
  const stillRegistered = (await store.listNoticeFiles(registered.orderId)).find((f) => f.id === registered.id);
  const latest = buildNotice(await store.getNoticeContext(registered.orderId));
  if (noticeSourceKey(latest) !== source || !stillRegistered || fileKey(stillRegistered) !== fileKey(registered)) {
    throw new DomainError('notice_export_stale', '核對期間訂單或圖片已改變，請重新開啟付款通知。');
  }
  return { file: registered, uri };
}

export interface NoticeExportPorts {
  prepare(file: NoticeFileRecord): Promise<{ uri: string }>;
  sharingAvailable(): Promise<boolean>;
  share(uri: string): Promise<void>;
  photoPermission(request: boolean): Promise<{ granted: boolean; canAskAgain: boolean }>;
  savePhoto(uri: string): Promise<void>;
  afterPhotoPermissionGranted?(): Promise<void>;
}
// One gate for both screens and operations. A native sheet cannot be cancelled
// reliably from JS, so keep the gate until its actual promise settles.
export class NoticeExporter {
  private running = false;
  async run(kind: NoticeExportKind, file: NoticeFileRecord, ports: NoticeExportPorts, active: () => boolean = () => true) {
    if (this.running) throw new DomainError('notice_export_busy', '圖片操作正在進行，請稍候。');
    this.running = true;
    try {
      if (!active()) throw new DomainError('notice_export_inactive', '請返回此頁後再匯出圖片。');
      await ports.prepare(file);
      if (kind === 'share') {
        if (!await ports.sharingAvailable()) throw new DomainError('notice_share_unavailable', '此裝置目前無法開啟系統分享面板，請稍後重試。');
      } else {
        let permission = await ports.photoPermission(false);
        if (!permission.granted && permission.canAskAgain) {
          permission = await ports.photoPermission(true);
          if (permission.granted) await ports.afterPhotoPermissionGranted?.();
        }
        if (!permission.granted) throw new DomainError('notice_photos_permission', '未獲允許新增相片。請到系統設定允許 OrderMori 儲存圖片，再重試。');
      }
      // Permission prompts and availability checks may yield to state changes.
      const prepared = await ports.prepare(file);
      if (!active()) throw new DomainError('notice_export_inactive', '請返回此頁後再匯出圖片。');
      if (kind === 'share') { await ports.share(prepared.uri); return '分享面板已關閉；未確認是否傳送。'; }
      await ports.savePhoto(prepared.uri); return '已儲存至相簿';
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      throw new DomainError('notice_export_failed', kind === 'share' ? '未能完成系統分享，請重試。本機 PNG 仍保留。' : '圖片未能儲存至相簿，請檢查權限及裝置空間後重試。本機 PNG 仍保留。');
    } finally { this.running = false; }
  }
}
