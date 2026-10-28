const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([
  expo,
  { ignores: ['spikes/**', 'node_modules/**', '.expo/**', 'dist/**', 'ios/**', 'android/**'] },
]);
