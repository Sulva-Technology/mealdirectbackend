import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'supabase/types/**',
      'eslint.config.js',
      'scripts/*.mjs',
      'load/**/*.js',
      'docs/api-docs/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }]
    }
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest
      }
    }
  },
  {
    files: ['src/**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off'
    }
  }
);
