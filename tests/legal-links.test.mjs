import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { legalPageUrl } from '../src/ui/legalLinks.ts';
import { LanguageController } from '../src/i18n/preferences.ts';

const require = createRequire(import.meta.url);
const release = require('../config/release.json');
const configure = require('../app.config.js');
const expected = {
  privacyPolicyUrl: 'https://ordermori-site.vercel.app/privacy/',
  supportUrl: 'https://ordermori-site.vercel.app/support/',
  privacyPolicyUrlEn: 'https://ordermori-site.vercel.app/en/privacy/',
  supportUrlEn: 'https://ordermori-site.vercel.app/en/support/',
};

test('release and Expo production config expose all four explicit public destinations without changing signing or versions', () => {
  for (const [key, url] of Object.entries(expected)) assert.equal(release[key], url);
  const previous = process.env.EAS_BUILD_PROFILE;
  process.env.EAS_BUILD_PROFILE = 'production';
  try {
    const config = configure({ config: { ios: { appleTeamId: 'SYNTHETIC', infoPlist: { Existing: true } }, extra: { other: 'retained' } } });
    assert.deepEqual(config.extra.legal, expected);
    assert.equal(config.extra.other, 'retained');
    assert.equal(config.extra.eas.projectId, 'f6b5d95f-789e-43dd-8066-d386cf2e800a');
    assert.equal(config.version, '1.0.0');
    assert.equal(config.ios.buildNumber, '1');
    assert.equal(config.ios.bundleIdentifier, 'com.zhushunli.ordermori');
    assert.equal(config.ios.supportsTablet, false);
    assert.equal(config.ios.appleTeamId, 'SYNTHETIC');
    assert.equal(config.ios.infoPlist.Existing, true);
  } finally {
    if (previous === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = previous;
  }
});

test('resolved manual and system languages choose the matching configured page independently of notice language', async () => {
  const language = new LanguageController();
  await language.initialize({ getItem: async () => 'system', setItem: async () => {} }, ['en-HK']);
  for (const [preference, locale] of [['system', 'en'], ['zh-HK', 'zh-HK'], ['en', 'en']]) {
    await language.select(preference);
    assert.equal(language.locale, locale);
    assert.equal(legalPageUrl(expected, 'privacy', language.locale), locale === 'en' ? expected.privacyPolicyUrlEn : expected.privacyPolicyUrl);
    assert.equal(legalPageUrl(expected, 'support', language.locale), locale === 'en' ? expected.supportUrlEn : expected.supportUrl);
  }
  await language.select('system');
  language.setSystem(['fr-FR']);
  assert.equal(legalPageUrl(expected, 'support', language.locale), expected.supportUrl);
});

test('production config rejects missing or non-HTTPS localized destinations instead of shipping unavailable links', () => {
  const previous = process.env.EAS_BUILD_PROFILE;
  process.env.EAS_BUILD_PROFILE = 'production';
  try {
    for (const key of Object.keys(expected)) {
      const saved = release[key];
      try {
        release[key] = null;
        assert.throws(() => configure({ config: {} }), /production preparation incomplete/);
        release[key] = 'http://ordermori-site.vercel.app/';
        assert.throws(() => configure({ config: {} }), /production preparation incomplete/);
      } finally { release[key] = saved; }
    }
  } finally {
    if (previous === undefined) delete process.env.EAS_BUILD_PROFILE;
    else process.env.EAS_BUILD_PROFILE = previous;
  }
});

test('missing or unsafe destinations stay unavailable; English never invents a URL or rewrites the Chinese URL', () => {
  for (const config of [null, undefined, {}, 'invalid']) assert.equal(legalPageUrl(config, 'privacy', 'zh-HK'), null);
  for (const candidate of ['', 'not a url', 'http://example.com/privacy/', 'javascript:alert(1)', 'mailto:test@example.com', 'https://user:password@example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://[::1]/', 123]) {
    assert.equal(legalPageUrl({ supportUrl: candidate }, 'support', 'zh-HK'), null);
  }
  assert.equal(legalPageUrl({ privacyPolicyUrl: expected.privacyPolicyUrl }, 'privacy', 'en'), null);
  assert.equal(legalPageUrl({ ...expected, supportUrlEn: undefined }, 'support', 'en'), null);
});
