import type { GlossaryPresetSourceConfig, MigrateConfig, TranslatorOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'

const DEFAULT_GLOSSARY_PRESET_REPO_URL = 'https://github.com/hackycy/translation-master/tree/main/packages/i18n-migrate-cli'

export type MigrateConfigInput = Omit<Partial<MigrateConfig>, 'translatorOptions' | 'glossaryPresets'> & {
  translatorOptions?: Partial<TranslatorOptions>
  glossaryPresets?: Partial<GlossaryPresetSourceConfig>
}

export function defaultGlossaryPresetIndex(): string {
  const rawBase = githubTreeToRawBaseUrl(DEFAULT_GLOSSARY_PRESET_REPO_URL)
  if (!rawBase)
    throw new Error(`Unsupported default glossary preset repository URL: ${DEFAULT_GLOSSARY_PRESET_REPO_URL}`)

  return new URL('src/glossary-presets/index.json', rawBase).toString()
}

export function githubTreeToRawBaseUrl(resource: string): string | undefined {
  let url: URL
  try {
    url = new URL(resource)
  }
  catch {
    return undefined
  }

  if (url.hostname !== 'github.com')
    return undefined

  const [owner, repo, section, ref, ...repoPathParts] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo || section !== 'tree' || !ref)
    return undefined

  const repoPath = repoPathParts.join('/')
  return repoPath
    ? `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${repoPath}/`
    : `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/`
}

const DEFAULT_GLOSSARY_PRESET_INDEX = defaultGlossaryPresetIndex()

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
    modelBaseUrl: '',
    apiKey: '',
    endpoint: '',
    chromeChannel: 'chrome',
    chromeExecutablePath: '',
    chromeHeadless: false,
    chromeUserDataDir: '',
    chromeKeepAlive: false,
    timeout: 30000,
    retries: 3,
    concurrency: 5,
  },
  glossaryPresets: {
    index: DEFAULT_GLOSSARY_PRESET_INDEX,
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
    glossaryPresets: {
      index: config.glossaryPresets?.index ?? DEFAULT_GLOSSARY_PRESET_INDEX,
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
