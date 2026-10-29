import { Inflate } from 'pako';
import { DomainError } from './model.ts';
import { readNoticePngHeader } from './noticePng.ts';

export interface NoticeInkRegion { label: string; top: number; bottom: number }
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let n = i; for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0;
});
export function pngCrc(bytes: Uint8Array, initial = 0xffffffff): number {
  let crc = initial; for (const n of bytes) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8); return crc >>> 0;
}
const uint = (b: Uint8Array, offset = 0) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset);
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c); return x <= y && x <= z ? a : y <= z ? b : c;
}
// Decode by scanline, retaining two rows and a small ink counter per output row.
// This catches wholly blank captures and blank item/footer regions, not typography or QR semantics.
export async function inspectNoticePixels(read: (offset: number, size: number) => Promise<Uint8Array>, fileSize: number, regions: NoticeInkRegion[]) {
  const head = await read(0, 33); const { width, height } = readNoticePngHeader(head);
  const depth = head[24], color = head[25]; const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color];
  if (!channels || ![8, 16].includes(depth) || head[26] !== 0 || head[27] !== 0 || head[28] !== 0 || width !== 1080 || width * height * 12 > 256 * 1024 * 1024) throw new DomainError('png', 'PNG 編碼或尺寸不在目前可安全驗證的範圍，未保存；請回報裝置及圖片尺寸。');
  const step = depth / 8, bpp = channels * step, stride = width * bpp;
  let previous = new Uint8Array(stride), current = new Uint8Array(stride), position = -1, filter = 0, y = 0;
  const ink = new Uint32Array(height); const inflater = new Inflate({ chunkSize: 32768 });
  inflater.onData = (chunk) => {
    for (const byte of chunk) {
      if (y >= height) throw new DomainError('png', 'PNG 解碼內容超出宣告高度。');
      if (position === -1) { filter = byte; position = 0; if (filter > 4) throw new DomainError('png', 'PNG 濾波資料損壞。'); continue; }
      const left = position >= bpp ? current[position - bpp] : 0, up = previous[position], corner = position >= bpp ? previous[position - bpp] : 0;
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : paeth(left, up, corner);
      current[position++] = (byte + prediction) & 255;
      if (position === stride) {
        for (let x = 0; x < width; x += 2) {
          const i = x * bpp, r = current[i], g = channels <= 2 ? r : current[i + step], b = channels <= 2 ? r : current[i + step * 2];
          const a = color === 4 || color === 6 ? current[i + (channels - 1) * step] : 255;
          if (a >= 128 && r + g + b < 570) ink[y]++;
        }
        y++; position = -1; const reusable = previous; previous = current; current = reusable;
      }
    }
  };
  let offset = 8, idat = false, end = false, first = true;
  while (offset < fileSize) {
    const h = await read(offset, 8); if (h.length !== 8) throw new DomainError('png', 'PNG 區塊未完整寫入。');
    const length = uint(h), type = String.fromCharCode(...h.slice(4, 8));
    if (length > fileSize - offset - 12 || (first && (type !== 'IHDR' || length !== 13))) throw new DomainError('png', 'PNG 區塊長度損壞。');
    let crc = pngCrc(h.slice(4, 8)); let processed = 0;
    while (processed < length) {
      const count = Math.min(4096, length - processed); const bytes = await read(offset + 8 + processed, count);
      if (bytes.length !== count) throw new DomainError('png', 'PNG 內容被截斷。'); crc = pngCrc(bytes, crc);
      if (type === 'IDAT') { idat = true; if (!inflater.push(bytes, false) || inflater.err) throw new DomainError('png', 'PNG 壓縮資料損壞，未保存。'); }
      processed += count;
    }
    const checksum = await read(offset + 8 + length, 4);
    if (checksum.length !== 4 || ((crc ^ 0xffffffff) >>> 0) !== uint(checksum)) throw new DomainError('png', 'PNG 完整性校驗失敗。');
    offset += length + 12; first = false;
    if (type === 'IEND') { if (length !== 0 || offset !== fileSize) throw new DomainError('png', 'PNG 檔尾異常。'); end = true; break; }
  }
  if (!inflater.ended) inflater.push(new Uint8Array(), true);
  if (!end || !idat || inflater.err || !inflater.ended || y !== height || position !== -1) throw new DomainError('png', 'PNG 解碼未完成，可能為半成品或空白截圖。');
  if (!ink.some((n) => n > 0)) throw new DomainError('png', '擷取結果沒有可見內容，已拒絕空白圖片。');
  for (const region of regions) {
    const start = Math.max(0, Math.floor(region.top)), stop = Math.min(height, Math.ceil(region.bottom)); let count = 0;
    for (let row = start; row < stop; row++) count += ink[row];
    if (stop <= start || count < 3) throw new DomainError('png', `${region.label}未見完整可見內容，可能被裁切；未保存此圖片。`);
  }
  return { width, height, checkedRegions: regions.length };
}
