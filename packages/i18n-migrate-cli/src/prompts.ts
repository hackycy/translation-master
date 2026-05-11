import type { MigrateConfigInput } from './config'
import process from 'node:process'
import { cancel, confirm, isCancel, multiselect, select, spinner, text } from '@clack/prompts'
import { getSupportedLanguages } from '@translation-master/core'

const PREFERRED_LOCALE_ORDER = [
  'zh',
  'zh-TW',
  'en',
  'ja',
  'ko',
  'es',
  'fr',
  'de',
  'ru',
  'ar',
  'pt',
  'it',
  'vi',
  'id',
  'tr',
  'hi',
  'th',
  'pl',
  'nl',
  'sv',
  'da',
  'fi',
  'no',
  'cs',
  'el',
  'he',
  'hu',
  'ro',
  'bg',
  'hr',
  'sk',
  'sr',
  'ca',
  'et',
  'lv',
  'lt',
  'bn',
  'ta',
  'te',
  'ml',
  'mr',
  'ur',
  'sw',
] as const

export async function promptInitConfig(defaults: MigrateConfigInput): Promise<MigrateConfigInput> {
  const localeOptions = getInitLocaleOptions()

  const sourceLocale = await select({
    message: 'Source locale',
    initialValue: defaults.sourceLocale ?? 'zh',
    options: localeOptions,
  })
  assertPromptValue(sourceLocale)

  const targetLocale = await select({
    message: 'Target locale',
    initialValue: defaults.targetLocale ?? 'en',
    options: localeOptions,
  })
  assertPromptValue(targetLocale)

  const fileTypes = await multiselect({
    message: 'File types to scan',
    initialValues: ['vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'html'],
    options: [
      { value: 'vue', label: 'Vue SFC' },
      { value: 'ts', label: 'TypeScript' },
      { value: 'tsx', label: 'TSX' },
      { value: 'js', label: 'JavaScript' },
      { value: 'jsx', label: 'JSX' },
      { value: 'json', label: 'JSON' },
      { value: 'html', label: 'HTML' },
      { value: 'css', label: 'CSS / SCSS / Less' },
      { value: 'md', label: 'Markdown' },
      { value: 'yaml', label: 'YAML' },
    ],
  })
  assertPromptValue(fileTypes)

  const sourceRoot = await text({
    message: 'Source root',
    initialValue: 'src',
    placeholder: 'src',
  })
  assertPromptValue(sourceRoot)

  const translator = await select({
    message: 'Translation backend',
    initialValue: defaults.translator ?? 'local',
    options: [
      { value: 'local', label: 'Local ONNX model' },
      { value: 'api', label: 'HTTP API endpoint' },
      { value: 'chrome', label: 'Chrome built-in Translator API' },
    ],
  })
  assertPromptValue(translator)

  const translatorOptions = await promptTranslatorOptions(translator, defaults)

  return {
    sourceLocale,
    targetLocale,
    include: [`${sourceRoot}/**/*.{${expandFileTypes(fileTypes).join(',')}}`],
    translator,
    ...(translatorOptions ? { translatorOptions } : {}),
  }
}

export async function confirmOverwriteTmigrate(): Promise<boolean> {
  const answer = await confirm({
    message: '.tmigrate already exists. Overwrite existing config and glossary?',
    initialValue: false,
  })
  assertPromptValue(answer)
  return answer
}

export function createSpinner() {
  return spinner()
}

export function getInitLocaleOptions() {
  const supported = getSupportedLanguages()
  const byCode = new Map(supported.map(language => [language.code, language]))
  const seen = new Set<string>()
  const options = []

  for (const code of PREFERRED_LOCALE_ORDER) {
    const language = byCode.get(code)
    if (!language)
      continue
    options.push(toPromptOption(language.code, language.name, language.nativeName))
    seen.add(language.code)
  }

  for (const language of supported) {
    if (seen.has(language.code))
      continue
    options.push(toPromptOption(language.code, language.name, language.nativeName))
  }

  return options
}

function assertPromptValue<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(0)
  }
}

function toPromptOption(code: string, name: string, nativeName?: string) {
  const label = nativeName && nativeName !== name
    ? `${name} (${code}) · ${nativeName}`
    : `${name} (${code})`

  return { value: code, label }
}

function expandFileTypes(types: string[]): string[] {
  return types.flatMap((type) => {
    if (type === 'css')
      return ['css', 'scss', 'less']
    if (type === 'yaml')
      return ['yaml', 'yml']
    return [type]
  })
}

async function promptTranslatorOptions(
  translator: NonNullable<MigrateConfigInput['translator']>,
  defaults: MigrateConfigInput,
): Promise<MigrateConfigInput['translatorOptions'] | undefined> {
  if (translator === 'local') {
    const modelBaseUrl = await text({
      message: 'Model base URL or path',
      initialValue: defaults.translatorOptions?.modelBaseUrl ?? '',
      placeholder: 'Leave empty to use the default HuggingFace model source',
    })
    assertPromptValue(modelBaseUrl)

    return typeof modelBaseUrl === 'string' && modelBaseUrl.trim()
      ? { modelBaseUrl: modelBaseUrl.trim() }
      : undefined
  }

  if (translator === 'api') {
    const endpoint = await text({
      message: 'Translation API endpoint',
      initialValue: defaults.translatorOptions?.endpoint ?? '',
      placeholder: 'https://translator.example.com/translate',
    })
    assertPromptValue(endpoint)

    const apiKey = await text({
      message: 'API key',
      initialValue: defaults.translatorOptions?.apiKey ?? '',
      placeholder: 'Leave empty if the endpoint does not require a token',
    })
    assertPromptValue(apiKey)

    return {
      endpoint: endpoint.trim(),
      apiKey: apiKey.trim(),
    }
  }

  const chromeChannel = await select({
    message: 'Chrome channel',
    initialValue: defaults.translatorOptions?.chromeChannel ?? 'chrome',
    options: [
      { value: 'chrome', label: 'Stable Chrome' },
      { value: 'chrome-beta', label: 'Chrome Beta' },
      { value: 'chrome-dev', label: 'Chrome Dev' },
      { value: 'chrome-canary', label: 'Chrome Canary' },
    ],
  })
  assertPromptValue(chromeChannel)

  const chromeExecutablePath = await text({
    message: 'Chrome executable path',
    initialValue: defaults.translatorOptions?.chromeExecutablePath ?? '',
    placeholder: 'Leave empty to use the selected Chrome channel',
  })
  assertPromptValue(chromeExecutablePath)

  return {
    chromeChannel,
    chromeExecutablePath: chromeExecutablePath.trim(),
    chromeHeadless: false,
  }
}
