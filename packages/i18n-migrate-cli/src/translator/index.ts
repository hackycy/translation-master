import type { MigrateConfig, Translator } from '../types'
import { ApiTranslator } from './api'
import { LocalTranslator } from './local'

export interface TranslatorLoadProgress {
  modelId: string
  progress: number
  state:
    | 'initiate'
    | 'download'
    | 'progress'
    | 'done'
    | 'ready'
    | 'browser-resolve'
    | 'browser-download'
    | 'browser-install-required'
    | 'browser-ready'
    | 'translator-create'
    | 'translator-download'
    | 'translator-timeout'
    | 'translator-ready'
    | 'translator-translated'
  file?: string
  cacheDir?: string
  executablePath?: string
  downloadUrl?: string
  version?: string
}

export interface CreateTranslatorOptions {
  onModelLoadProgress?: (event: TranslatorLoadProgress) => void
}

export function createTranslator(config: MigrateConfig, options: CreateTranslatorOptions = {}): Translator {
  if (config.translator === 'chrome') {
    return new LazyChromeTranslator({
      browserExecutablePath: config.translatorOptions.chromeBrowserExecutablePath || undefined,
      browserCacheDir: config.translatorOptions.chromeBrowserCacheDir || undefined,
      browserChannel: config.translatorOptions.chromeBrowserChannel,
      browserBuildId: config.translatorOptions.chromeBrowserBuildId || undefined,
      browserVisible: config.translatorOptions.chromeBrowserVisible,
      timeout: config.translatorOptions.timeout,
      onDownloadProgress(event) {
        options.onModelLoadProgress?.({
          modelId: 'chrome-translator',
          progress: event.progress,
          state: event.state as TranslatorLoadProgress['state'],
          file: event.file,
          cacheDir: event.cacheDir,
          executablePath: event.executablePath,
          downloadUrl: event.downloadUrl,
          version: event.version,
        })
      },
    })
  }

  if (config.translator === 'api' && config.translatorOptions.endpoint) {
    return new ApiTranslator({
      apiKey: config.translatorOptions.apiKey,
      endpoint: config.translatorOptions.endpoint,
      timeout: config.translatorOptions.timeout,
    })
  }

  return new LocalTranslator({
    modelBaseUrl: config.translatorOptions.modelBaseUrl,
    onModelLoadProgress: options.onModelLoadProgress,
  })
}

type ChromeTranslatorConstructor = new (options?: {
  browserExecutablePath?: string
  browserCacheDir?: string
  browserChannel?: 'stable' | 'beta' | 'dev' | 'canary'
  browserBuildId?: string
  browserVisible?: boolean
  timeout?: number
  onDownloadProgress?: (event: { progress: number, state: string, file?: string, cacheDir?: string, executablePath?: string, downloadUrl?: string, version?: string }) => void
}) => Translator

class LazyChromeTranslator implements Translator {
  private translator: Translator | null = null
  private loading: Promise<Translator> | null = null

  constructor(private readonly options: ConstructorParameters<ChromeTranslatorConstructor>[0]) {}

  async translate(texts: string[], options: Parameters<Translator['translate']>[1]) {
    return this.getTranslator().then(translator => translator.translate(texts, options))
  }

  async dispose(): Promise<void> {
    const translator = this.translator ?? await this.loading
    await translator?.dispose?.()
    this.translator = null
    this.loading = null
  }

  private async getTranslator(): Promise<Translator> {
    if (this.translator)
      return this.translator
    if (!this.loading)
      this.loading = loadChromeTranslator(this.options)
    this.translator = await this.loading
    return this.translator
  }
}

async function loadChromeTranslator(options: ConstructorParameters<ChromeTranslatorConstructor>[0]): Promise<Translator> {
  try {
    const mod = await import(/* @vite-ignore */ '@translation-master/chrome') as { ChromeTranslator: ChromeTranslatorConstructor }
    return new mod.ChromeTranslator(options)
  }
  catch (error) {
    throw new Error(
      'Chrome translator requires the optional package "@translation-master/chrome". '
      + 'Install it before using translator: "chrome".',
      { cause: error instanceof Error ? error : new Error(String(error)) },
    )
  }
}
