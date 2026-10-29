// Extend the existing local config without rewriting personal signing settings.
module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    ['expo-image-picker', {
      photosPermission: '選擇商家從官方工具取得的收款二維碼。',
      cameraPermission: false,
      microphonePermission: false,
    }],
  ],
});
