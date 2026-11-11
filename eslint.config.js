import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

export default defineConfig(
  // Whatever git ignores (dependencies, build and test output) is not linted either.
  includeIgnoreFile(fileURLToPath(new URL('.gitignore', import.meta.url))),
  // The Angular app lints itself with its own configuration.
  globalIgnores(['fixtures/shop/']),
  js.configs.recommended,
  {
    files: ['**/*.{ts,mts,cts}'],
    extends: [tseslint.configs.recommendedTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Node runs this code by stripping types, and it cannot transform decorators.
      // `erasableSyntaxOnly` in tsconfig.base.json covers enums and the rest.
      'no-restricted-syntax': [
        'error',
        { selector: 'Decorator', message: 'Decorators cannot run under Node type stripping.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    rules: { 'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }] },
  },
  prettier,
);
