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
      'max-depth': ['error', 4],
      'max-params': ['warn', 4],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'no-constant-binary-expression': 'error',
      'no-duplicate-case': 'error',
      'no-else-return': 'error',
      'no-unreachable': 'error',
      'no-useless-catch': 'error',
      'no-useless-constructor': 'error',
      '@typescript-eslint/no-duplicate-enum-values': 'error',
      '@typescript-eslint/no-useless-constructor': 'error',
    },
  },
);
