import { DomainError } from './model.ts';
export interface NoticeSize { width: number; height: number }
export function captureReleasePath(uri: string): string { return uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri; }
export function noticeCapturePlan(size: NoticeSize, pixelRatio: number) {
  if (![size.width, size.height, pixelRatio].every((n) => Number.isFinite(n) && n > 0)) throw new DomainError('render', '完整佈局尚未就緒。');
  const height = Math.round(size.height / size.width * 1080);
  // Allocation guard, not a claim that this height has passed device testing. Never truncate.
  if (!Number.isSafeInteger(height) || height < 1 || 1080 * height * 4 * 3 > 256 * 1024 * 1024) throw new DomainError('render', `此通知預計高 ${height} px，超出目前單張位圖安全預算。未裁切內容；請回報此訂單的項數及尺寸以便修復。`);
  return { width: 1080 / pixelRatio, height: height / pixelRatio, expectedWidth: 1080, expectedHeight: height };
}
export function readNoticePngHeader(bytes: Uint8Array): NoticeSize {
  if (bytes.length < 24 || [137, 80, 78, 71, 13, 10, 26, 10].some((n, i) => bytes[i] !== n)) throw new DomainError('png', '未取得有效 PNG 檔頭。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new DomainError('png', 'PNG 尺寸欄位不完整。');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 0x7fffffff || height > 0x7fffffff) throw new DomainError('png', 'PNG 尺寸無效。');
  return { width, height };
}
export function hasPngEnd(bytes: Uint8Array): boolean {
  return bytes.length === 12 && [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130].every((n, i) => bytes[i] === n);
}
