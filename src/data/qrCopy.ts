import { DomainError } from '../domain/model.ts';
import type { PaymentAsset } from '../domain/payment.ts';

export interface QrFileInfo { bytes: number; sha256: string; mime: PaymentAsset['mime']; width: number; height: number }
export interface QrCopyPort {
  inspect(uri: string): Promise<QrFileInfo>;
  copy(source: string, relativePath: string): Promise<string>;
  removeNewFile(relativePath: string): Promise<void>;
}
export async function copyOfficialQr(source: string, shopId: string, kind: 'fps' | 'payme', id: string, io: QrCopyPort): Promise<PaymentAsset> {
  let relativePath: string | null = null;
  let copiedByThisRequest = false;
  try {
    if (!source.startsWith('file://') || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Unsupported local input');
    const original = await io.inspect(source);
    relativePath = `payment-assets/${id}.${original.mime === 'image/png' ? 'png' : 'jpg'}`;
    const uri = await io.copy(source, relativePath);
    copiedByThisRequest = true;
    const copied = await io.inspect(uri);
    if (original.sha256 !== copied.sha256 || original.bytes !== copied.bytes || original.mime !== copied.mime ||
      original.width !== copied.width || original.height !== copied.height) throw new Error('Copy integrity mismatch');
    return { id, shopId, kind, relativePath, ...copied };
  } catch (error) {
    // A failed exclusive copy may have collided with an existing file. Never
    // delete a destination unless this request successfully created it.
    if (relativePath && copiedByThisRequest) { try { await io.removeNewFile(relativePath); } catch { /* Only the new unreferenced file may remain. */ } }
    if (error instanceof DomainError) throw error;
    throw new DomainError('asset', '圖片複製或完整性檢查失敗，原有收款資料未變更。');
  }
}
