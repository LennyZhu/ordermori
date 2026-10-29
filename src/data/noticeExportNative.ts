import { AppState, Platform } from 'react-native';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { DomainError } from '../domain/model';
import { NoticeExporter, prepareNoticeExport } from '../domain/noticeExport';
import { waitForPermissionForeground } from '../domain/permissionForeground';
import type { NoticeExportKind, NoticeExportPorts } from '../domain/noticeExport';
import type { NoticeFileRecord } from '../domain/notice';
import type { OrderStore } from './store';
import { verifyNoticeFile } from './noticeFiles';

const exporter = new NoticeExporter();
const digest = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
export const prepareNativeNoticeExport = (store: OrderStore, file: NoticeFileRecord) => prepareNoticeExport(store, file, digest, verifyNoticeFile);
const missingBuild = () => new DomainError('notice_export_build', '此 Development Build 尚未包含分享或照片元件，請重新構建 App 後再試。');
const sharing = () => import('expo-sharing').catch(() => { throw missingBuild(); });
const photos = () => import('expo-media-library').catch(() => { throw missingBuild(); });
export function exportNativeNotice(store: OrderStore, file: NoticeFileRecord, kind: NoticeExportKind, mounted: () => boolean) {
  if (Platform.OS !== 'ios') return Promise.reject(new DomainError('notice_export_platform', '目前只開放 iOS 圖片分享與相簿儲存。'));
  let sharingModule: typeof import('expo-sharing') | undefined;
  let photosModule: typeof import('expo-media-library') | undefined;
  const ports: NoticeExportPorts = {
    prepare: (record) => prepareNativeNoticeExport(store, record),
    sharingAvailable: async () => { sharingModule = await sharing(); return sharingModule.isAvailableAsync(); },
    share: async (uri) => { if (!sharingModule) throw missingBuild(); await sharingModule.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: '分享付款通知' }); },
    photoPermission: async (request) => {
      const media = photosModule ??= await photos();
      // This is the SDK 58 next API export; true requests iOS add-only access.
      return request ? media.requestPermissionsAsync(true, ['photo']) : media.getPermissionsAsync(true, ['photo']);
    },
    afterPhotoPermissionGranted: () => waitForPermissionForeground({
      current: () => AppState.currentState ?? null,
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    }, mounted),
    savePhoto: async (uri) => { if (!photosModule) throw missingBuild(); await photosModule.Asset.create(uri); },
  };
  return exporter.run(kind, file, ports, () => mounted() && AppState.currentState === 'active');
}
