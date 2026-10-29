import { Image } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { DomainError } from '../domain/model';
import { hasPngEnd, readNoticePngHeader } from '../domain/noticePng';
import { noticeSourceKey } from '../domain/notice';
import type { NoticeDocument, NoticeFileRecord } from '../domain/notice';
import type { OrderStore } from './store';
import { inspectNoticePixels } from '../domain/noticePixels';
import type { NoticeInkRegion } from '../domain/noticePixels';
import { NoticeStageError } from '../domain/noticeDiagnostics';

const folder = () => new Directory(Paths.document, 'ordermori', 'payment-notices');
export function noticeFileUri(record: Pick<NoticeFileRecord, 'id' | 'relativePath'>): string {
  if (!/^[a-f0-9-]{36}$/.test(record.id) || record.relativePath !== `payment-notices/${record.id}.png`) throw new DomainError('notice', '付款通知檔案路徑無效。');
  return new File(folder(), `${record.id}.png`).uri;
}
export async function inspectNoticePng(uri: string, regions?: NoticeInkRegion[]) {
  const file = new File(uri);
  if (!uri.startsWith('file://') || !file.exists || file.size < 45) throw new NoticeStageError('temp-file', new DomainError('png', '找不到完整 PNG 檔案，請重新產生。'));
  const handle = file.open(FileMode.ReadOnly);
  let dimensions;
  try {
    const header = await handle.readBytes(24); handle.offset = file.size - 12;
    dimensions = readNoticePngHeader(header);
    if (!hasPngEnd(await handle.readBytes(12))) throw new DomainError('png', 'PNG 檔尾不完整，未保存半成品。');
  } catch (cause) { throw new NoticeStageError(cause instanceof DomainError ? 'png-validation' : 'temp-file', cause); }
  finally { handle.close(); }
  if (regions) {
    const pixels = file.open(FileMode.ReadOnly);
    try { await inspectNoticePixels(async (offset, length) => { pixels.offset = offset; return pixels.readBytes(length); }, file.size, regions); }
    catch (cause) { throw new NoticeStageError('png-validation', cause); }
    finally { pixels.close(); }
  }
  const decoded = await Image.getSize(uri).catch((cause: unknown) => { throw new NoticeStageError('png-validation', cause); });
  if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) throw new DomainError('png', '圖片解碼尺寸與 PNG 檔頭不一致。');
  return { ...dimensions, bytes: file.size, sha256: await file.digest('SHA-256') };
}
export async function persistNoticePng(store: OrderStore, document: NoticeDocument, tempUri: string, active: () => boolean = () => true): Promise<NoticeFileRecord> {
  const sourceKey = noticeSourceKey(document); const current = await store.getNoticeContext(document.orderId);
  // Recheck status and sources before copying. Store checks again in its final transaction.
  const { buildNotice } = await import('../domain/notice');
  if (noticeSourceKey(buildNotice(current)) !== sourceKey) throw new DomainError('conflict', '訂單或通知設定已更新，請重新產生預覽。');
  if (!active()) throw new DomainError('notice', '已離開頁面，未保存此次輸出。');
  const original = await inspectNoticePng(tempUri);
  if (original.width !== 1080) throw new DomainError('png', 'PNG 寬度並非 1080 px，未保存。');
  const id = randomUUID(); const relativePath = `payment-notices/${id}.png`;
  const target = new File(noticeFileUri({ id, relativePath })); let copied = false;
  try {
    await folder().create({ intermediates: true, idempotent: true }); await new File(tempUri).copy(target, { overwrite: false }); copied = true;
    const saved = await inspectNoticePng(target.uri);
    if (saved.sha256 !== original.sha256 || saved.bytes !== original.bytes || saved.width !== original.width || saved.height !== original.height) throw new DomainError('png', 'PNG 複製完整性檢查失敗，未保存。');
    const record: NoticeFileRecord = { id, orderId: document.orderId, shopId: document.shopId, orderRevision: document.orderRevision,
      preferencesRevision: document.preferencesRevision, template: document.template, relativePath, ...saved,
      dataHash: await digestStringAsync(CryptoDigestAlgorithm.SHA256, sourceKey), createdAt: new Date().toISOString() };
    await store.recordNoticeFile(record, sourceKey, active); return record;
  } catch (cause) {
    if (copied && target.exists) { try { await target.delete(); } catch { /* Unreferenced output only; never remove source QR assets. */ } }
    if (cause instanceof DomainError) throw cause;
    throw new DomainError('notice', 'PNG 未能安全保存，請檢查裝置空間後重試。訂單、額度及原圖未變更。');
  }
}
export async function verifyNoticeFile(record: NoticeFileRecord) {
  const uri = noticeFileUri(record), actual = await inspectNoticePng(uri);
  if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes || actual.width !== record.width || actual.height !== record.height) throw new DomainError('notice', '付款通知檔案已缺失或改變，不會用另一張圖片替代。');
  return uri;
}
export async function removeSavedNotice(store: OrderStore, record: NoticeFileRecord) {
  const file = new File(noticeFileUri(record)); if (file.exists) await file.delete();
  await store.removeNoticeFile(record.orderId, record.id);
}
