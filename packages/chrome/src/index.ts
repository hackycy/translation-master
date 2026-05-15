import type { BrowserContext, BrowserType, Page } from 'playwright-core'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MIN_CHROME_TRANSLATOR_MAJOR_VERSION = 138
const GOOGLE_CHROME_DOWNLOAD_URL = 'https://www.google.com/chrome/'
const CHROME_TRANSLATOR_LANGUAGES = new Set([
  'ar',
  'bg',
  'bn',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'iw',
  'ja',
  'kn',
  'ko',
  'lt',
  'mr',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'vi',
  'zh',
  'zh-Hant',
])

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
  userDataDir?: string
  keepAlive?: boolean
  browserVisible?: boolean
  timeout?: number
  browserExecutablePath?: string
  browserChannel?: 'stable' | 'beta' | 'dev' | 'canary'
  onDownloadProgress?: (event: ChromeDownloadProgressEvent) => void
}

export interface ChromeDownloadProgressEvent {
  progress: number
  state: string
  file?: string
  executablePath?: string
  downloadUrl?: string
  version?: string
  phase?: 'browser' | 'translator'
}

export class ChromeTranslator implements Translator {
  private readonly options: ChromeTranslatorOptions
  private context: BrowserContext | null = null
  private page: Page | null = null
  private ready: Promise<void> | null = null
  private queue = Promise.resolve()
  private userDataDir: string | null = null
  private bridgeServer: BridgeServer | null = null

  constructor(options: ChromeTranslatorOptions = {}) {
    this.options = options
  }

  async preflight(options: TranslateOptions): Promise<void> {
    await this.ensureReady()
    const page = this.page
    if (!page)
      throw new Error('Chrome translator page was not initialized.')

    const timeout = this.options.timeout ?? 30000
    const languagePair = normalizeChromeTranslatorLanguagePair(options.sourceLocale, options.targetLocale)
    const needsActivation = await this.prepareTranslator(page, languagePair.sourceLanguage, languagePair.targetLanguage, timeout)
    if (needsActivation) {
      await page.click('#activate')
    }
    await this.waitForTranslatorReady(page, languagePair.sourceLanguage, languagePair.targetLanguage, timeout)
  }

  async translate(texts: string[], options: TranslateOptions): Promise<TranslateResult[]> {
    const task = this.queue.then(async () => {
      await this.ensureReady()
      const page = this.page
      if (!page)
        throw new Error('Chrome translator page was not initialized.')

      let translations: string[]
      try {
        const timeout = this.options.timeout ?? 30000
        const languagePair = normalizeChromeTranslatorLanguagePair(options.sourceLocale, options.targetLocale)
        const needsActivation = await this.prepareTranslator(page, languagePair.sourceLanguage, languagePair.targetLanguage, timeout)

        if (needsActivation)
          await page.click('#activate')

        await this.waitForTranslatorReady(page, languagePair.sourceLanguage, languagePair.targetLanguage, timeout)
        translations = await this.translatePreparedTexts(page, texts, languagePair.sourceLanguage, languagePair.targetLanguage, timeout)
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
    await this.disposeBridgeServer()
    this.context = null
    this.page = null
    this.ready = null
    if (!this.options.keepAlive)
      await removeBrowserProfileDir(this.userDataDir)
    this.userDataDir = null
    this.bridgeServer = null
  }

  private async ensureReady(): Promise<void> {
    if (!this.ready)
      this.ready = this.initialize()
    return this.ready
  }

  private async initialize(): Promise<void> {
    const { chromium } = await loadPlaywright()
    const browser = await resolveChromeBrowser(this.options)
    const userDataDir = await this.resolveUserDataDir()
    this.bridgeServer = await createBridgeServer()
    try {
      this.context = await chromium.launchPersistentContext(userDataDir, {
        executablePath: browser.executablePath,
        headless: this.options.browserVisible === false,
        args: [
          '--enable-features=OptimizationGuideOnDeviceModel,TranslateKit',
        ],
      })
      this.page = await this.context.newPage()
      await this.page.exposeFunction('__tmigrateReportDownload', (event: unknown) => {
        if (isProgressEvent(event))
          this.options.onDownloadProgress?.(event)
      })
      await this.page.goto(this.bridgeServer.url)

      const available = await this.page.evaluate(() => {
        return 'Translator' in globalThis
      })
      if (!available) {
        throw new Error(
          'Chrome Translator API is not available in the launched browser. '
          + `Browser path: ${browser.executablePath}. `
          + 'Use desktop Google Chrome 138+ with built-in AI translation support enabled.',
        )
      }
    }
    catch (error) {
      await this.disposeBridgeServer()
      throw error
    }
  }

  private async disposeBridgeServer(): Promise<void> {
    if (!this.bridgeServer)
      return
    try {
      await this.bridgeServer.close()
    }
    finally {
      this.bridgeServer = null
    }
  }

  private async resolveUserDataDir(): Promise<string> {
    if (this.userDataDir)
      return this.userDataDir
    if (this.options.userDataDir) {
      this.userDataDir = this.options.userDataDir
      return this.userDataDir
    }
    this.userDataDir = await mkdtemp(path.join(os.tmpdir(), 'tmigrate-chrome-translator-'))
    return this.userDataDir
  }

  private async prepareTranslator(page: Page, sourceLocale: string, targetLocale: string, timeout: number): Promise<boolean> {
    return page.evaluate(({ sourceLocale, targetLocale, timeout }) => {
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
        __tmigrateReportDownload?: (event: ChromeDownloadProgressEvent) => void
      }

      if (!api.Translator) {
        throw new Error(
          'Chrome Translator API is not available. Use desktop Chrome 138+ and enable Built-in AI translation support.',
        )
      }

      const createOptions = {
        sourceLanguage: sourceLocale,
        targetLanguage: targetLocale,
        timeout,
      }
      if (api.__tmigrateTranslator?.key === `${sourceLocale}->${targetLocale}`)
        return false
      if (!api.__tmigratePrepareTranslator)
        throw new Error('Chrome translator bridge is not initialized.')
      api.__tmigrateReportDownload?.({
        progress: 0,
        state: 'translator-create',
        phase: 'translator',
      })
      return api.__tmigratePrepareTranslator(createOptions)
    }, {
      sourceLocale,
      targetLocale,
      timeout,
    })
  }

  private async waitForTranslatorReady(page: Page, sourceLocale: string, targetLocale: string, timeout: number): Promise<void> {
    await page.evaluate(async ({ sourceLocale, targetLocale, timeout }) => {
      const api = globalThis as typeof globalThis & {
        Translator?: {
          availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
        }
        __tmigrateTranslator?: {
          key: string
          translator: { translate: (text: string) => Promise<string>, destroy?: () => void }
        }
        __tmigrateTranslatorReady?: Promise<void>
        __tmigrateReportDownload?: (event: ChromeDownloadProgressEvent) => void
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
            setTimeout(() => reject(new Error(`Chrome Translator.create timed out after ${timeout}ms. If the model is still downloading, run with a visible Google Chrome window and make sure chrome://on-device-internals has no model errors.`)), timeout)
          }),
        ])
      }

      if (api.__tmigrateTranslator?.key !== key)
        throw new Error('Chrome translator did not initialize for the requested language pair.')
      api.__tmigrateReportDownload?.({
        progress: 100,
        state: 'translator-ready',
        phase: 'translator',
      })
    }, {
      sourceLocale,
      targetLocale,
      timeout,
    })
  }

  private async translatePreparedTexts(page: Page, texts: string[], sourceLocale: string, targetLocale: string, timeout: number): Promise<string[]> {
    return page.evaluate(async ({ texts, sourceLocale, targetLocale, timeout }) => {
      const api = globalThis as typeof globalThis & {
        Translator?: {
          availability: (options: { sourceLanguage: string, targetLanguage: string }) => Promise<string>
        }
        __tmigrateTranslator?: {
          key: string
          translator: { translate: (text: string) => Promise<string>, destroy?: () => void }
        }
        __tmigrateReportDownload?: (event: ChromeDownloadProgressEvent) => void
      }

      if (!api.Translator)
        throw new Error('Chrome Translator API is not available.')

      const key = `${sourceLocale}->${targetLocale}`
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
      sourceLocale,
      targetLocale,
      timeout,
    })
  }
}

export interface ChromeTranslatorLanguagePair {
  sourceLanguage: string
  targetLanguage: string
}

export function normalizeChromeTranslatorLanguagePair(sourceLocale: string, targetLocale: string): ChromeTranslatorLanguagePair {
  return {
    sourceLanguage: normalizeChromeTranslatorLanguageCode(sourceLocale),
    targetLanguage: normalizeChromeTranslatorLanguageCode(targetLocale),
  }
}

export function normalizeChromeTranslatorLanguageCode(locale: string): string {
  const normalized = locale.trim().replace(/_/g, '-')
  if (!normalized)
    throw new Error('Chrome Translator language code cannot be empty.')

  const lower = normalized.toLowerCase()
  if (lower === 'iw' || lower === 'he' || lower.startsWith('he-'))
    return 'iw'
  if (lower === 'zh-hant' || lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo')
    return 'zh-Hant'
  if (lower === 'zh-hans' || lower === 'zh-cn' || lower === 'zh-sg' || lower === 'zh-my')
    return 'zh'

  const direct = findChromeTranslatorLanguage(normalized)
  if (direct)
    return direct

  const baseLanguage = lower.split('-')[0]
  const base = baseLanguage ? findChromeTranslatorLanguage(baseLanguage) : undefined
  if (base)
    return base

  throw new Error(`Chrome Translator API does not support language code "${locale}".`)
}

function findChromeTranslatorLanguage(locale: string): string | undefined {
  for (const language of CHROME_TRANSLATOR_LANGUAGES) {
    if (language.toLowerCase() === locale.toLowerCase())
      return language
  }
}

async function resolveChromeBrowser(options: ChromeTranslatorOptions): Promise<{ executablePath: string }> {
  options.onDownloadProgress?.({
    progress: 0,
    state: 'browser-resolve',
    phase: 'browser',
  })

  if (options.browserExecutablePath) {
    const executablePath = path.resolve(options.browserExecutablePath)
    if (!existsSync(executablePath))
      throw new Error(`Configured Chrome executable was not found: ${executablePath}`)

    const version = await ensureCompatibleGoogleChrome(executablePath)
    options.onDownloadProgress?.({
      progress: 100,
      state: 'browser-ready',
      executablePath,
      file: executablePath,
      version,
      phase: 'browser',
    })
    return { executablePath }
  }

  const executablePath = findSystemChromeExecutable(options.browserChannel ?? 'stable')
  if (!executablePath) {
    options.onDownloadProgress?.({
      progress: 0,
      state: 'browser-install-required',
      downloadUrl: GOOGLE_CHROME_DOWNLOAD_URL,
      phase: 'browser',
    })
    throw new Error(
      'Google Chrome was not found. Chrome Translator requires desktop Google Chrome '
      + `${MIN_CHROME_TRANSLATOR_MAJOR_VERSION}+; download it from ${GOOGLE_CHROME_DOWNLOAD_URL} `
      + 'or set browserExecutablePath to an installed Google Chrome executable.',
    )
  }

  const version = await ensureCompatibleGoogleChrome(executablePath)
  options.onDownloadProgress?.({
    progress: 100,
    state: 'browser-ready',
    executablePath,
    file: executablePath,
    version,
    phase: 'browser',
  })

  return { executablePath }
}

function findSystemChromeExecutable(channel: NonNullable<ChromeTranslatorOptions['browserChannel']>): string | undefined {
  const candidates = systemChromeExecutableCandidates(channel)
  return candidates.find(candidate => existsSync(candidate))
}

function systemChromeExecutableCandidates(channel: NonNullable<ChromeTranslatorOptions['browserChannel']>): string[] {
  if (process.platform === 'darwin') {
    const appName = channel === 'stable'
      ? 'Google Chrome.app'
      : `Google Chrome ${capitalizeChromeChannel(channel)}.app`
    const executableName = channel === 'stable'
      ? 'Google Chrome'
      : `Google Chrome ${capitalizeChromeChannel(channel)}`
    const homeApplications = path.join(os.homedir(), 'Applications', appName, 'Contents', 'MacOS', executableName)
    return [
      path.join('/Applications', appName, 'Contents', 'MacOS', executableName),
      homeApplications,
    ]
  }

  if (process.platform === 'win32') {
    const suffix = channel === 'stable' ? '' : ` ${capitalizeChromeChannel(channel)}`
    const executable = path.join('Google', `Chrome${suffix}`, 'Application', 'chrome.exe')
    return [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, executable) : '',
      process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, executable) : '',
      process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], executable) : '',
    ].filter(Boolean)
  }

  if (channel === 'stable') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ]
  }

  return [
    `/usr/bin/google-chrome-${channel}`,
    `/opt/google/chrome-${channel}/chrome`,
  ]
}

function capitalizeChromeChannel(channel: Exclude<NonNullable<ChromeTranslatorOptions['browserChannel']>, 'stable'>): string {
  if (channel === 'dev')
    return 'Dev'
  return channel[0].toUpperCase() + channel.slice(1)
}

async function ensureCompatibleGoogleChrome(executablePath: string): Promise<string> {
  const versionText = await readChromeVersion(executablePath)
  if (/Chrome for Testing/i.test(versionText)) {
    throw new Error(
      `Chrome Translator requires desktop Google Chrome, but got ${versionText}. `
      + `Download Google Chrome from ${GOOGLE_CHROME_DOWNLOAD_URL}.`,
    )
  }

  const majorVersion = parseChromeMajorVersion(versionText)
  if (!majorVersion || majorVersion < MIN_CHROME_TRANSLATOR_MAJOR_VERSION) {
    throw new Error(
      `Chrome Translator requires Google Chrome ${MIN_CHROME_TRANSLATOR_MAJOR_VERSION}+; got ${versionText}. `
      + `Upgrade Google Chrome from ${GOOGLE_CHROME_DOWNLOAD_URL}.`,
    )
  }

  return versionText
}

async function readChromeVersion(executablePath: string): Promise<string> {
  try {
    if (process.platform === 'win32')
      return await readWindowsChromeVersion(executablePath)

    const { stdout, stderr } = await execFileAsync(executablePath, ['--version'], { timeout: 10000 })
    return (stdout || stderr).trim()
  }
  catch (error) {
    throw new Error(`Failed to read Google Chrome version from ${executablePath}.`, { cause: toError(error) })
  }
}

async function readWindowsChromeVersion(executablePath: string): Promise<string> {
  try {
    return await readWindowsChromeFileVersion(executablePath)
  }
  catch (error) {
    try {
      const version = await readWindowsChromeDirectoryVersion(executablePath)
      if (version)
        return `Google Chrome ${version}`
    }
    catch {
      // Preserve the file-version error because it explains the primary Windows version lookup failure.
    }
    throw error
  }
}

async function readWindowsChromeFileVersion(executablePath: string): Promise<string> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$chromePath = $env:CHROME_TRANSLATOR_EXECUTABLE_PATH',
    'if (-not $chromePath) { throw "Chrome executable path was not provided." }',
    '$item = Get-Item -LiteralPath $chromePath',
    '$name = $item.VersionInfo.ProductName',
    '$version = $item.VersionInfo.ProductVersion',
    'if (-not $name) { $name = "Google Chrome" }',
    'if (-not $version) { $version = $item.VersionInfo.FileVersion }',
    'if (-not $version) { throw "Chrome executable has no file version." }',
    'Write-Output "$name $version"',
  ].join('; ')
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    timeout: 10000,
    env: {
      ...process.env,
      CHROME_TRANSLATOR_EXECUTABLE_PATH: executablePath,
    },
  })
  const versionText = stdout.trim()
  if (!versionText)
    throw new Error('Chrome executable has no file version.')
  return versionText
}

async function readWindowsChromeDirectoryVersion(executablePath: string): Promise<string | undefined> {
  const applicationDir = path.dirname(executablePath)
  const entries = await readdir(applicationDir, { withFileTypes: true })
  return entries
    .filter(entry => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(entry.name))
    .map(entry => entry.name)
    .sort(compareVersionDesc)[0]
}

function compareVersionDesc(a: string, b: string): number {
  const aParts = a.split('.').map(Number)
  const bParts = b.split('.').map(Number)
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index += 1) {
    const diff = (bParts[index] ?? 0) - (aParts[index] ?? 0)
    if (diff)
      return diff
  }
  return 0
}

export function parseChromeMajorVersion(versionText: string): number | undefined {
  const match = /\b(?:Google\s+)?Chrome(?:\s+for\s+Testing)?\s+(\d+)\./i.exec(versionText)
  return match ? Number(match[1]) : undefined
}

export function normalizeDownloadProgress(loaded: unknown, total: unknown): number {
  const safeLoaded = typeof loaded === 'number' ? loaded : 0
  const safeTotal = typeof total === 'number' ? total : 0
  const rawProgress = safeLoaded <= 1
    ? safeLoaded * 100
    : safeTotal > 0
      ? (safeLoaded / safeTotal) * 100
      : safeLoaded

  return Math.max(0, Math.min(100, Math.round(rawProgress)))
}

async function removeBrowserProfileDir(dir: string | null): Promise<void> {
  if (!dir)
    return
  try {
    const { rm } = await import('node:fs/promises')
    await rm(dir, { recursive: true, force: true })
  }
  catch {
    // Best-effort cleanup; stale dirs are acceptable if the browser crashes.
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

interface BridgeServer {
  url: string
  close: () => Promise<void>
}

async function createBridgeServer(): Promise<BridgeServer> {
  const html = bridgeHtml()
  const server = createServer((_, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    })
    response.end(html)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Failed to start Chrome bridge server.')

  return {
    url: `http://localhost:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    }),
  }
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
    let createToken = 0;

    function normalizeBridgeDownloadProgress(loaded, total) {
      const safeLoaded = typeof loaded === 'number' ? loaded : 0;
      const safeTotal = typeof total === 'number' ? total : 0;
      const rawProgress = safeLoaded <= 1
        ? safeLoaded * 100
        : safeTotal > 0
          ? (safeLoaded / safeTotal) * 100
          : safeLoaded;
      return Math.max(0, Math.min(100, Math.round(rawProgress)));
    }

    function reportTranslatorProgress(progress, state) {
      api.__tmigrateReportDownload && api.__tmigrateReportDownload({ progress, state, phase: 'translator' });
    }

    api.__tmigratePrepareTranslator = async function(options) {
      if (api.__tmigrateTranslator && api.__tmigrateTranslator.key === options.sourceLanguage + '->' + options.targetLanguage)
        return false;

      createToken += 1;
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
        const token = createToken;
        const key = pending.sourceLanguage + '->' + pending.targetLanguage;
        if (api.__tmigrateTranslator && api.__tmigrateTranslator.key === key) {
          api.__tmigrateResolveTranslator && api.__tmigrateResolveTranslator();
          return;
        }

        if (api.__tmigrateTranslator && api.__tmigrateTranslator.translator.destroy)
          api.__tmigrateTranslator.translator.destroy();

        const createPromise = api.Translator.create({
          sourceLanguage: pending.sourceLanguage,
          targetLanguage: pending.targetLanguage,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => {
              const progress = normalizeBridgeDownloadProgress(event.loaded, event.total);
              reportTranslatorProgress(progress, 'translator-download');
            });
          },
        });
        createPromise.then((lateTranslator) => {
          if (token !== createToken && lateTranslator && lateTranslator.destroy)
            lateTranslator.destroy();
        }).catch(() => {});
        const translator = await Promise.race([
          createPromise,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Chrome Translator.create timed out after ' + pending.timeout + 'ms.')), pending.timeout);
          }),
        ]);

        if (token !== createToken) {
          if (translator && translator.destroy)
            translator.destroy();
          return;
        }

        api.__tmigrateTranslator = { key, translator };
        api.__tmigratePendingTranslator = null;
        reportTranslatorProgress(100, 'translator-ready');
        api.__tmigrateResolveTranslator && api.__tmigrateResolveTranslator();
      }
      catch (error) {
        createToken += 1;
        reportTranslatorProgress(0, 'translator-timeout');
        api.__tmigratePendingTranslator = null;
        api.__tmigrateRejectTranslator && api.__tmigrateRejectTranslator(error);
      }
    });
  </script>
</body>
</html>`
}

function isProgressEvent(value: unknown): value is ChromeDownloadProgressEvent {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { progress?: unknown }).progress === 'number'
    && typeof (value as { state?: unknown }).state === 'string'
}
