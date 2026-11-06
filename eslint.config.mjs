// npm run lint: the recommended rules, with the globals each part runs among. The site's
// modules run in the page and in workers; tools in Node; tests in Node and, in page.evaluate, the page.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['site/vendor/', '.tmp-*/', '.claude/'] }, // the libraries, as npm ships them; local scratch; agents' worktrees
  js.configs.recommended,
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  { files: ['site/**/*.js'], languageOptions: { globals: { ...globals.browser, ...globals.worker } } },
  { files: ['test/**/*.mjs', 'tools/preview.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser, map: 'readonly', drawing: 'readonly' } } }, // the page's, in page.evaluate (map, drawing: its globals)
  { files: ['tools/**/*.mjs', '*.mjs'], languageOptions: { globals: globals.node } }, // Node only: a stray document or window is an error
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none', ignoreRestSiblings: true }], eqeqeq: ['error', 'always', { null: 'ignore' }], 'no-var': 'error', 'prefer-const': 'error', 'no-unused-expressions': ['error', { allowTernary: true }] } },
];
