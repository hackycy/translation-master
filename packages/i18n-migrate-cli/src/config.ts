import type { AdaptConfig, ConvertConfig, GlossaryPresetSourceConfig, MigrateConfig, TranslatorOptions } from './types'
import path from 'node:path'
import process from 'node:process'
import { readJsonFile } from './fs-utils'

const DEFAULT_GLOSSARY_PRESET_REPO_URL = 'https://github.com/hackycy/translation-master/tree/main/packages/i18n-migrate-cli'

export type MigrateConfigInput = Omit<Partial<MigrateConfig>, 'convert' | 'translatorOptions' | 'glossaryPresets'> & {
  translatorOptions?: Partial<TranslatorOptions>
  glossaryPresets?: Partial<GlossaryPresetSourceConfig>
  convert?: Partial<ConvertConfig>
  adapt?: Partial<AdaptConfig> & {
    callee?: Partial<AdaptConfig['callee']>
    keyReference?: Partial<AdaptConfig['keyReference']>
    import?: {
      script?: Partial<AdaptConfig['import']['script']>
    }
  }
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

const DEFAULT_CONVERT_CONFIG: ConvertConfig = {
  outputDir: 'locales/langs',
  format: 'json',
  includeSourceLocale: true,
  translateMissing: false,
  legacyTextKey: false,
}

const DEFAULT_ADAPT_CONFIG: AdaptConfig = {
  callee: {
    vue: '$t',
    script: 't',
    default: 't',
  },
  keyReference: {
    mode: 'local',
    separator: '.',
  },
  import: {
    script: {
      enabled: false,
      source: 'vue-i18n',
      specifier: 'useI18n',
    },
  },
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
    modelBaseUrl: '',
    apiKey: '',
    endpoint: '',
    chromeBrowserExecutablePath: '',
    chromeBrowserChannel: 'stable',
    chromeBrowserVisible: true,
    timeout: 30000,
    retries: 3,
    concurrency: 5,
  },
  glossaryPresets: {
    index: DEFAULT_GLOSSARY_PRESET_INDEX,
  },
  convert: DEFAULT_CONVERT_CONFIG,
  adapt: DEFAULT_ADAPT_CONFIG,
  batchSize: 20,
}

export function defineConfig(config: MigrateConfigInput): MigrateConfig {
  const convert: ConvertConfig = {
    ...DEFAULT_CONVERT_CONFIG,
    ...config.convert,
    outputDir: config.convert?.outputDir ?? DEFAULT_CONVERT_CONFIG.outputDir,
    format: config.convert?.format ?? DEFAULT_CONVERT_CONFIG.format,
    includeSourceLocale: config.convert?.includeSourceLocale ?? DEFAULT_CONVERT_CONFIG.includeSourceLocale,
    translateMissing: config.convert?.translateMissing ?? DEFAULT_CONVERT_CONFIG.translateMissing,
    legacyTextKey: config.convert?.legacyTextKey ?? DEFAULT_CONVERT_CONFIG.legacyTextKey,
  }

  const adapt: AdaptConfig = {
    callee: {
      ...DEFAULT_ADAPT_CONFIG.callee,
      ...config.adapt?.callee,
    },
    keyReference: {
      ...DEFAULT_ADAPT_CONFIG.keyReference,
      ...config.adapt?.keyReference,
    },
    import: {
      script: {
        ...DEFAULT_ADAPT_CONFIG.import.script,
        ...config.adapt?.import?.script,
      },
    },
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    exclude: mergeExcludeWithConvertOutput(config.exclude ?? DEFAULT_CONFIG.exclude, convert.outputDir),
    translatorOptions: {
      ...DEFAULT_CONFIG.translatorOptions,
      ...config.translatorOptions,
    },
    glossaryPresets: {
      index: config.glossaryPresets?.index ?? DEFAULT_GLOSSARY_PRESET_INDEX,
    },
    convert,
    adapt,
  }
}

function mergeExcludeWithConvertOutput(exclude: string[], outputDir: string): string[] {
  const normalizedOutput = outputDir.replace(/\\/g, '/').replace(/\/$/, '')
  if (!normalizedOutput)
    return exclude

  const next = [...exclude]
  if (!next.includes(normalizedOutput))
    next.push(normalizedOutput)
  if (!next.includes(`${normalizedOutput}/**`))
    next.push(`${normalizedOutput}/**`)
  return next
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
