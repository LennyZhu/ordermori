// Extend the existing local config without rewriting personal signing settings.
module.exports = ({ config }) => ({
  ...config,
  locales: { ...(config.locales ?? {}), en: './locales/en.json', 'zh-HK': './locales/zh-HK.json' },
  ios: { ...config.ios, infoPlist: { ...config.ios?.infoPlist, CFBundleAllowMixedLocalizations: true } },
  plugins: [
    ...(config.plugins ?? []),
    ['expo-localization', { supportedLocales: { ios: ['zh-HK', 'en'], android: ['zh-HK', 'en'] } }],
    ['expo-image-picker', {
      photosPermission: '選擇商家從官方工具取得的收款二維碼。',
      cameraPermission: false,
      microphonePermission: false,
    }],
    ['expo-sharing', { ios: { enabled: false }, android: { enabled: false } }],
    ['expo-media-library', {
      photosPermission: '選擇商家從官方工具取得的收款二維碼。',
      savePhotosPermission: '將你選擇的付款通知圖片儲存至相簿，方便手動傳送給客人。',
      granularPermissions: [],
      isAccessMediaLocationEnabled: false,
      preventAutomaticLimitedAccessAlert: true,
    }],
  ],
});
