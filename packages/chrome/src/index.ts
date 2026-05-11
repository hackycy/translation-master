import type { BrowserContext, BrowserType, Page } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface TranslateOptions {
  sourceLocale: string
  targetLocale: string
}

export interface TranslateResult {
  source: string
  translation: string
  translationSource: 'machine'
  confidence?: number
}

export interface Translator {
  translate: (texts: string[], options: TranslateOptions) => Promise<TranslateResult[]>
  dispose?: () => Promise<void>
}

export interface ChromeTranslatorOptions {
  channel?: string
  executablePath?: string
  headless?: boolean
  userDataDir?: string
  keepAlive?: boolean
  timeout?: number
  onDownloadProgress?: (event: { progress: number, state: string, file?: string }) => void
}

export class ChromeTranslator implements Translator {
  private readonly options: ChromeTranslatorOptions
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ready: Promise<void> | null = null
  private queue = Promise.resolve()

  constructor(options: ChromeTranslatorOptions = {}) {
    this.options = options
  }

  async translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    const task = this.queue.then(async () => {
      await this.ensureReady()
      const page = this.page
      if (!page)
        throw new Error('Chrome translator page was not initialized.')

      let translations: string[]
      try {
        const needsActivation = await page.evaluate(({ sourceLocale, targetLocale, timeout }) => {
          const api = globalThis as typeof globalThis & {
            Translator?: {
              availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
            }
            __tmigrateTranslator?: {
              key: string
            }
            __tmigratePrepareTranslator?: (options: {
              sourceLanguage: string
              targetLanguage: string
              timeout: number
            }) => Promise<boolean>
          }

          if (!api.Translator) {
            throw new Error(
              'Chrome Translator API is not available. Use desktop Chrome 138+ and enable Built-in AI translation support.',
            )
          }

          const createOptions = {
            sourceLanguage: sourceLocale,
            targetLanguage: targetLocale,
          }
          if (api.__tmigrateTranslator?.key === `${sourceLocale}->${targetLocale}`)
            return false
          if (!api.__tmigratePrepareTranslator)
            throw new Error('Chrome translator bridge is not initialized.')
          return api.__tmigratePrepareTranslator({ ...createOptions, timeout })
        }, {
          sourceLocale: options.sourceLocale,
          targetLocale: options.targetLocale,
          timeout: this.options.timeout ?? 30000,
        })

        if (needsActivation)
          await page.click('#activate')

        translations = await page.evaluate(async ({ texts, sourceLocale, targetLocale, timeout }) => {
          const api = globalThis as typeof globalThis & {
            Translator?: {
              availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
            }
            __tmigrateTranslator?: {
              key: string
              translator: { translate: (text: string) => Promise<string>, destroy?: () => void }
            }
            __tmigrateTranslatorReady?: Promise<void>
          }

          if (!api.Translator)
            throw new Error('Chrome Translator API is not available.')

          const createOptions = {
            sourceLanguage: sourceLocale,
            targetLanguage: targetLocale,
          }
          const availability = await api.Translator.availability(createOptions)
          if (availability === 'unavailable') {
            throw new Error(`Chrome Translator API does not support ${sourceLocale}->${targetLocale}.`)
          }

          const key = `${sourceLocale}->${targetLocale}`
          if (api.__tmigrateTranslator?.key !== key) {
            if (!api.__tmigrateTranslatorReady)
              throw new Error('Chrome translator was not activated.')
            await Promise.race([
              api.__tmigrateTranslatorReady,
              new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Chrome Translator.create timed out after ${timeout}ms`)), timeout)
              }),
            ])
          }

          if (api.__tmigrateTranslator?.key !== key)
            throw new Error('Chrome translator did not initialize for the requested language pair.')

          const translator = api.__tmigrateTranslator.translator
          const results: string[] = []
          for (const text of texts) {
            const translated = await Promise.race([
              translator.translate(text),
              new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error(`Chrome translate timed out after ${timeout}ms`)), timeout)
              }),
            ])
            results.push(translated)
          }
          return results
        }, {
          texts,
          sourceLocale: options.sourceLocale,
          targetLocale: options.targetLocale,
          timeout: this.options.timeout ?? 30000,
        })
      }
      catch (error) {
        throw wrapError(`Chrome translator failed for ${options.sourceLocale}->${options.targetLocale} (${texts.length} text(s))`, error)
      }

      return texts.map((text, index) => ({
        source: text,
        translation: translations[index] ?? text,
        translationSource: 'machine' as const,
      }))
    })

    this.queue = task.then(
      () => undefined,
      () => undefined,
    )
    return task as Promise<TranslateResult[]>
  }

  async dispose(): Promise<void> {
    await this.queue
    if (this.context && !this.options.keepAlive)
      await this.context.close()
    this.context = null
    this.page = null
    this.ready = null
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready)
      this.ready = this.initialize()
    return this.ready
  }

  private async initialize(): Promise<void> {
    const { chromium } = await loadPlaywright()
    const userDataDir = this.options.userDataDir || path.join(os.tmpdir(), 'tmigrate-chrome-translator')
    this.context = await chromium.launchPersistentContext(userDataDir, {
      channel: this.options.executablePath ? undefined : this.options.channel ?? 'chrome',
      executablePath: this.options.executablePath || undefined,
      headless: this.options.headless ?? false,
      args: [
        '--enable-features=OptimizationGuideOnDeviceModel,TranslateKit',
        '--disable-features=Translate',
      ],
    })
    this.page = await this.context.newPage()
    await this.page.exposeFunction('__tmigrateReportDownload', (event: unknown) => {
      if (isProgressEvent(event))
        this.options.onDownloadProgress?.(event)
    })
    await this.page.goto(await createBridgePageUrl())

    const available = await this.page.evaluate(() => {
      return 'Translator' in globalThis
    })
    if (!available) {
      throw new Error(
        'Chrome Translator API is not available in the launched browser. '
        + 'Use desktop Chrome 138+ with Built-in AI translation enabled, or configure chromeExecutablePath.',
      )
    }
  }
}

async function loadPlaywright(): Promise<{ chromium: BrowserType }> {
  try {
    return await import('playwright-core')
  }
  catch (error) {
    throw new Error(
      'Chrome translator requires the optional dependency "playwright-core". '
      + 'Install it in the project before using translator: "chrome".',
      { cause: toError(error) },
    )
  }
}

function wrapError(message: string, cause: unknown): Error {
  return new Error(message, { cause: toError(cause) })
}

function toError(error: unknown): Error {
  if (error instanceof Error)
    return error
  if (typeof error === 'string')
    return new Error(error)
  try {
    return new Error(JSON.stringify(error))
  }
  catch {
    return new Error(String(error))
  }
}

async function createBridgePageUrl(): Promise<string> {
  const filePath = path.join(os.tmpdir(), 'tmigrate-chrome-translator.html')
  await writeFile(filePath, bridgeHtml(), 'utf8')
  return pathToFileURL(filePath).toString()
}

function bridgeHtml(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>tmigrate chrome translator</title>
</head>
<body>
  <button id="activate" type="button">Activate translator</button>
  <script>
    const api = globalThis;
    const button = document.getElementById('activate');

    api.__tmigratePrepareTranslator = async function(options) {
      if (api.__tmigrateTranslator && api.__tmigrateTranslator.key === options.sourceLanguage + '->' + options.targetLanguage)
        return false;

      api.__tmigratePendingTranslator = options;
      api.__tmigrateTranslatorReady = new Promise((resolve, reject) => {
        api.__tmigrateResolveTranslator = resolve;
        api.__tmigrateRejectTranslator = reject;
      });
      return true;
    };

    button.addEventListener('click', async () => {
      const pending = api.__tmigratePendingTranslator;
      if (!pending || !api.Translator)
        return;

      try {
        const key = pending.sourceLanguage + '->' + pending.targetLanguage;
        if (api.__tmigrateTranslator && api.__tmigrateTranslator.key === key) {
          api.__tmigrateResolveTranslator && api.__tmigrateResolveTranslator();
          return;
        }

        if (api.__tmigrateTranslator && api.__tmigrateTranslator.translator.destroy)
          api.__tmigrateTranslator.translator.destroy();

        const translator = await Promise.race([
          api.Translator.create({
            sourceLanguage: pending.sourceLanguage,
            targetLanguage: pending.targetLanguage,
            monitor(monitor) {
              monitor.addEventListener('downloadprogress', (event) => {
                const total = event.total || 0;
                const progress = total > 0 ? Math.round(((event.loaded || 0) / total) * 100) : 0;
                api.__tmigrateReportDownload && api.__tmigrateReportDownload({ progress, state: 'download' });
              });
            },
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Chrome Translator.create timed out after ' + pending.timeout + 'ms')), pending.timeout);
          }),
        ]);

        api.__tmigrateTranslator = { key, translator };
        api.__tmigratePendingTranslator = null;
        api.__tmigrateReportDownload && api.__tmigrateReportDownload({ progress: 100, state: 'ready' });
        api.__tmigrateResolveTranslator && api.__tmigrateResolveTranslator();
      }
      catch (error) {
        api.__tmigrateRejectTranslator && api.__tmigrateRejectTranslator(error);
      }
    });
  </script>
</body>
</html>`
}

function isProgressEvent(value: unknown): value is { progress: number, state: string, file?: string } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { progress?: unknown }).progress === 'number'
    && typeof (value as { state?: unknown }).state === 'string'
}
