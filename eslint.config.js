import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'reports/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.mjs', 'test-support/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      complexity: ['error', 4],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
);
