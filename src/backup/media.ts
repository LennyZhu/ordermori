import { failBackup } from './archive.ts';
import type { MediaRef } from './data.ts';
export interface MediaPort {
  size(path: string): Promise<number | null>;
  hash(path: string): Promise<string>;
  header(path: string): Promise<Uint8Array>;
  dimensions(path: string): Promise<{ width:number; height:number }>;
}
export async function verifyBackupMedia(refs: MediaRef[], io: MediaPort) {
  for (const ref of refs) {
    if (await io.size(ref.path) !== ref.size || await io.hash(ref.path) !== ref.sha256) failBackup('必要圖片缺失或 SHA-256 校驗失敗；未進行部分還原。');
    const header = await io.header(ref.path);
    const png = [137,80,78,71,13,10,26,10].every((n,i) => header[i] === n);
    const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
    if ((ref.path.endsWith('.png') && !png) || (ref.path.endsWith('.jpg') && !jpeg)) failBackup('圖片格式與檔案記錄不符。');
    const size = await io.dimensions(ref.path);
    if (size.width !== ref.width || size.height !== ref.height) failBackup('圖片尺寸校驗失敗。');
  }
}
