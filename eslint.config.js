import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', 'apps/desktop/src-tauri/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.config.ts',
            'apps/dashboard/vite.config.ts',
            'apps/dashboard/vitest.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['apps/dashboard/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // In the server, stdout carries JSON-RPC to the shell: log with pino, never console.
    files: ['apps/server/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // Plugin overlays run in the browser, with the SDK's `overly` global (checked by tsc).
    files: ['plugins/*/overlay/**/*.js'],
    languageOptions: { globals: { ...globals.browser, overly: 'readonly' } },
  },
  prettier,
);
