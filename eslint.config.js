import js from '@eslint/js';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';
import astro from 'eslint-plugin-astro';
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.astro/**', '.test-sites/**', 'test-results/**', 'playwright-report/**', 'src/generated/**'] },
  js.configs.recommended,
  ...astro.configs['flat/recommended'],
  { files: ['**/*.astro'], languageOptions: { parserOptions: { parser: tsParser } } },
  { files: ['**/*.ts'], languageOptions: { parser: tsParser } },
  { files: ['**/*.{js,mjs,ts,astro}'], languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }] } },
  // Declaration parameters describe an API; they have no runtime use sites.
  { files: ['**/*.d.ts'], rules: { 'no-unused-vars': 'off' } },
];
