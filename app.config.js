const fs = require('node:fs');
const path = require('node:path');
const { version } = require('./package.json');
const release = require('./config/release.json');
const projectRoot = path.dirname(require.resolve('./package.json'));

const isPublicHttps = (value) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.hostname.includes('.');
  } catch { return false; }
};

// Keep personal signing settings in the existing local config. EAS excludes
// ios/ and regenerates native version, device family and resources via Prebuild.
module.exports = ({ config }) => {
  const projectId = release.easProjectId ?? config.extra?.eas?.projectId;
  const icon = release.iconPath;
  const missing = [];
  if (!/^\d+$/.test(release.iosBuildNumber)) throw new Error('Invalid release iosBuildNumber.');
  if (!release.iosBuildNumberConfirmedUnused) missing.push('confirm this version/build number is unused in App Store Connect');
  if (typeof projectId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(projectId)) missing.push('real EAS projectId');
  if (typeof icon !== 'string' || !/^\.\/assets\/.+\.png$/i.test(icon) || icon.split('/').includes('..') || !fs.existsSync(path.resolve(projectRoot, icon))) missing.push('approved PNG icon under assets/');
  if (!isPublicHttps(release.privacyPolicyUrl)) missing.push('public OrderMori privacy policy HTTPS URL');
  if (!isPublicHttps(release.supportUrl)) missing.push('public OrderMori support HTTPS URL');
  if (!isPublicHttps(release.privacyPolicyUrlEn)) missing.push('public OrderMori English privacy policy HTTPS URL');
  if (!isPublicHttps(release.supportUrlEn)) missing.push('public OrderMori English support HTTPS URL');
  if (process.env.EAS_BUILD_PROFILE === 'production' && missing.length) {
    throw new Error(`OrderMori production preparation incomplete: ${missing.join('; ')}. Update config/release.json after verification.`);
  }
  return {
    ...config,
    version,
    ...(icon ? { icon } : {}),
    extra: {
      ...config.extra,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
      legal: {
        ...(isPublicHttps(release.privacyPolicyUrl) ? { privacyPolicyUrl: release.privacyPolicyUrl } : {}),
        ...(isPublicHttps(release.supportUrl) ? { supportUrl: release.supportUrl } : {}),
        ...(isPublicHttps(release.privacyPolicyUrlEn) ? { privacyPolicyUrlEn: release.privacyPolicyUrlEn } : {}),
        ...(isPublicHttps(release.supportUrlEn) ? { supportUrlEn: release.supportUrlEn } : {}),
      },
    },
    locales: { ...(config.locales ?? {}), en: './locales/en.json', 'zh-HK': './locales/zh-HK.json' },
    ios: { ...config.ios, bundleIdentifier: 'com.zhushunli.ordermori', supportsTablet: false, buildNumber: release.iosBuildNumber,
      infoPlist: { ...config.ios?.infoPlist, CFBundleAllowMixedLocalizations: true } },
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
  };
};
