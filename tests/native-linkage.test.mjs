import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the installed SDK's real resolver consumed by use_expo_modules!.
// This checks configuration/registration, not native compilation or launch.
test('iOS autolinking sources only MediaLibrary and still registers sharing, photos and localization modules', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cli = fileURLToPath(new URL('../node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js', import.meta.url));
  const resolved = JSON.parse(execFileSync(process.execPath, [cli, 'resolve', '--platform', 'apple', '--json'], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(resolved.configuration.buildFromSource, ['expo-media-library']);
  const media = resolved.modules.find((m) => m.packageName === 'expo-media-library');
  const sharing = resolved.modules.find((m) => m.packageName === 'expo-sharing');
  assert.ok(media?.pods.some((p) => p.podName === 'ExpoMediaLibrary'));
  assert.ok(media?.modules.some((m) => m.class === 'MediaLibraryNextModule'));
  assert.ok(sharing?.pods.some((p) => p.podName === 'ExpoSharing'));
  const localization = resolved.modules.find((m) => m.packageName === 'expo-localization');
  assert.ok(localization?.pods.some((p) => p.podName === 'ExpoLocalization'));
  assert.ok(localization?.modules.some((m) => m.class === 'LocalizationModule'));
});
