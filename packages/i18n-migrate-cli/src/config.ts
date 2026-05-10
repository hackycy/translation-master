import type { MigrateConfig, TranslatorOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'

export type MigrateConfigInput = Omit<Partial<MigrateConfig>, 'translatorOptions'> & {
  translatorOptions?: Partial<TranslatorOptions>
}

export const DEFAULT_CONFIG: MigrateConfig = {
  sourceLocale: 'zh',
  targetLocale: 'en',
  include: ['src/**/*.{vue,ts,tsx,js,jsx,json,html,css,scss,less,md,yaml,yml}'],
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

export function defineConfig(config: MigrateConfigInput): MigrateConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    translatorOptions: {
      ...DEFAULT_CONFIG.translatorOptions,
      ...config.translatorOptions,
    },
  }
}

export async function loadConfig(cwd = process.cwd(), overrides: MigrateConfigInput = {}): Promise<MigrateConfig> {
  const configPath = path.join(cwd, '.tmigrate', 'config.json')
  const config = await readJsonFile<MigrateConfigInput>(configPath, {})
  return defineConfig({
    ...config,
    ...overrides,
    translatorOptions: {
      ...config.translatorOptions,
      ...overrides.translatorOptions,
    },
  })
}
