import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const apps = [
  '@web-legend/game-web',
  '@web-legend/admin-web',
  '@web-legend/control-api',
  '@web-legend/game-server',
];

const serverPackages = [
  '@web-legend/persistence',
  '@web-legend/persistence/*',
  '@web-legend/config',
  '@web-legend/config/*',
  '@web-legend/observability',
  '@web-legend/observability/*',
  '@web-legend/testkit',
  '@web-legend/testkit/*',
  '@web-legend/game-simulation',
  '@web-legend/game-simulation/*',
];

const serverFrameworks = [
  { name: 'fastify', message: 'Browser code must not import server frameworks.' },
  { name: 'express', message: 'Browser code must not import server frameworks.' },
  { name: 'pino', message: 'Browser code must not import the server logger.' },
  { name: 'postgres', message: 'Browser code must not import database drivers.' },
  { name: 'drizzle-orm', message: 'Browser code must not import the ORM.' },
  {
    name: '@colyseus/core',
    message: 'Browser code must use @colyseus/sdk, never server internals.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/persistence/migrations/**',
      'eslint.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['apps/game-web/**/*.{ts,tsx}', 'apps/admin-web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: [
      'apps/control-api/**/*.ts',
      'apps/game-server/**/*.ts',
      'packages/**/*.ts',
      'tests/**/*.ts',
      '*.config.ts',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/game-web/**/*.{ts,tsx}', 'apps/admin-web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...serverFrameworks,
            ...apps.map((name) => ({ name, message: 'Apps do not import each other.' })),
          ],
          patterns: [
            { group: serverPackages, message: 'Browser code may not import server packages.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/admin-web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...serverFrameworks,
            ...apps.map((name) => ({ name, message: 'Apps do not import each other.' })),
            { name: 'phaser', message: 'The admin console must not bundle the game renderer.' },
          ],
          patterns: [
            {
              group: [...serverPackages, '@web-legend/game-web', '@web-legend/game-web/*'],
              message:
                'The admin console talks to the Control API; it does not import server or game code.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: apps, message: 'Packages must never depend on applications.' }],
        },
      ],
    },
  },
  {
    files: ['apps/control-api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@web-legend/game-server', '@web-legend/game-server/*'],
              message: 'Do not reach into the game server process.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/game-server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@web-legend/control-api', '@web-legend/control-api/*'],
              message: 'Do not reach into the control API process.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
