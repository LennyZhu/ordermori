import { businessMediaRoot } from './mediaRoot';
import { Image } from 'react-native';
import { Directory, File, FileMode } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { DomainError } from '../domain/model';
import type { PaymentAsset, QrState } from '../domain/payment';
import { copyOfficialQr } from './qrCopy';
import type { QrCopyPort, QrFileInfo } from './qrCopy';

const root = businessMediaRoot;
export function paymentAssetUri(asset: Pick<PaymentAsset, 'relativePath'>): string {
  if (!/^payment-assets\/[a-f0-9-]{36}\.(png|jpg)$/.test(asset.relativePath)) throw new DomainError('asset', '收款圖片路徑不完整。');
  return new File(root(), asset.relativePath).uri;
}
async function inspect(uri: string): Promise<QrFileInfo> {
  if (!uri.startsWith('file://')) throw new DomainError('asset', '只接受由系統選圖匯入的本機圖片。');
  const file = new File(uri);
  if (!file.exists || file.size <= 0) throw new DomainError('asset', '找不到收款圖片，請重新匯入官方原圖。');
  if (file.size > 20 * 1024 * 1024) throw new DomainError('asset', '圖片超過 20 MB，請使用較小的官方 PNG 或 JPEG 原圖；App 不會壓縮付款碼。');
  const handle = file.open(FileMode.ReadOnly);
  let signature: Uint8Array;
  try { signature = await handle.readBytes(8); } finally { handle.close(); }
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => signature[i] === byte);
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  if (!png && !jpeg) throw new DomainError('asset', '只支援 PNG 或 JPEG 官方原圖；不會轉換 HEIC、GIF 或其他格式。');
  const dimensions = await Image.getSize(uri);
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40000000 || Math.max(dimensions.width, dimensions.height) > 12000) {
    throw new DomainError('asset', '圖片尺寸過大或無法讀取，請重新匯入適合手機使用的官方原圖。');
  }
  return { bytes: file.size, sha256: await file.digest('SHA-256'), mime: png ? 'image/png' : 'image/jpeg', ...dimensions };
}
const filePort: QrCopyPort = {
  inspect,
  async copy(source, relativePath) {
    const folder = new Directory(root(), 'payment-assets');
    await folder.create({ intermediates: true, idempotent: true });
    const target = new File(root(), relativePath);
    await new File(source).copy(target, { overwrite: false });
    return target.uri;
  },
  async removeNewFile(relativePath) {
    const target = new File(paymentAssetUri({ relativePath }));
    if (target.exists) await target.delete();
  },
};
export async function chooseOfficialQr(shopId: string, kind: 'fps' | 'payme'): Promise<PaymentAsset | null> {
  try {
    const ImagePicker = await import('expo-image-picker');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: false, quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      exif: false, base64: false,
    });
    if (result.canceled) return null;
    const selected = result.assets[0];
    if (!selected?.uri) throw new Error('No selected file');
    return await copyOfficialQr(selected.uri, shopId, kind, randomUUID(), filePort);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError('asset', '未能選取或讀取圖片。請檢查系統照片存取設定，再選擇官方 PNG 或 JPEG 原圖。');
  }
}
export async function verifyPaymentAsset(asset: PaymentAsset): Promise<QrState> {
  try {
    const uri = paymentAssetUri(asset);
    if (!new File(uri).exists) return 'missing';
    const info = await inspect(uri);
    return info.bytes === asset.bytes && info.sha256 === asset.sha256 && info.mime === asset.mime && info.width === asset.width && info.height === asset.height ? 'available' : 'invalid';
  } catch { return 'invalid'; }
}
