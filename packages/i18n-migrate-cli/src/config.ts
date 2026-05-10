import type { MigrateConfig } from './types'

export const DEFAULT_CONFIG: MigrateConfig = {
  sourceLocale: 'zh',
  targetLocale: 'en',
  include: ['src/**/*.{vue,ts,tsx,js,jsx,json,html}'],
  exclude: [
    'node_modules',
    'dist',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/i18n/**',
  ],
  rules: [
    { type: 'skip-context', value: 'console' },
    { type: 'skip-context', value: 'comment' },
    { type: 'skip-context', value: 'enum' },
    { type: 'skip-context', value: 'test' },
    { type: 'skip-pattern', value: '^[\\d\\s]+$' },
    { type: 'skip-pattern', value: '^[a-zA-Z]' },
    { type: 'min-length', value: 2 },
  ],
  translator: 'local',
  translatorOptions: {
    modelBaseUrl: 'https://cdn.example.com/models',
    apiKey: '',
    timeout: 30000,
    retries: 3,
    concurrency: 5,
  },
  batchSize: 20,
}

export function defineConfig(config: Partial<MigrateConfig>): MigrateConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    translatorOptions: {
      ...DEFAULT_CONFIG.translatorOptions,
      ...config.translatorOptions,
    },
  }
}
