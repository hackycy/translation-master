import type { ModelLoadProgress } from '@translation-master/node'
import type { MigrateConfig, Translator } from '../types'
import { ApiTranslator } from './api'
import { LocalTranslator } from './local'

export interface CreateTranslatorOptions {
  onModelLoadProgress?: (event: ModelLoadProgress) => void
}

export function createTranslator(config: MigrateConfig, options: CreateTranslatorOptions = {}): Translator {
  if (config.translator === 'chrome') {
    return new LazyChromeTranslator({
      channel: config.translatorOptions.chromeChannel,
      executablePath: config.translatorOptions.chromeExecutablePath,
      headless: config.translatorOptions.chromeHeadless,
      userDataDir: config.translatorOptions.chromeUserDataDir,
      keepAlive: config.translatorOptions.chromeKeepAlive,
      timeout: config.translatorOptions.timeout,
      onDownloadProgress(event) {
        options.onModelLoadProgress?.({
          modelId: 'chrome-translator',
          progress: event.progress,
          state: event.state as ModelLoadProgress['state'],
          file: event.file,
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
  channel?: string
  executablePath?: string
  headless?: boolean
  userDataDir?: string
  keepAlive?: boolean
  timeout?: number
  onDownloadProgress?: (event: { progress: number, state: string, file?: string }) => void
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
    const mod = await import('@translation-master/chrome') as { ChromeTranslator: ChromeTranslatorConstructor }
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
