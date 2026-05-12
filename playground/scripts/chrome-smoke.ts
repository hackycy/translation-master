import process from 'node:process'
import { ChromeTranslator } from '../../packages/chrome/src/index'

const cacheDir = process.env.TMIGRATE_CHROME_CACHE_DIR
  ?? `${process.cwd()}/.tmigrate/chrome-smoke`
const browserVisible = process.env.TMIGRATE_CHROME_VISIBLE !== '0'
const browserExecutablePath = process.env.TMIGRATE_CHROME_EXECUTABLE_PATH || undefined
const sourceLocale = process.env.TMIGRATE_CHROME_SOURCE_LOCALE ?? 'zh'
const targetLocale = process.env.TMIGRATE_CHROME_TARGET_LOCALE ?? 'en'
const observedStates: string[] = []

const translator = new ChromeTranslator({
  browserExecutablePath,
  browserCacheDir: cacheDir,
  browserVisible,
  onDownloadProgress(event) {
    observedStates.push(`${event.phase ?? 'browser'}:${event.state}:${event.progress}`)
    const suffix = event.executablePath ? ` · ${event.executablePath}` : ''
    const phase = event.phase === 'translator'
      ? 'translator'
      : 'browser'
    const progress = event.state === 'translator-create' || event.state === 'translator-ready'
      ? ''
      : ` ${event.progress}%`
    process.stdout.write(`\x1B[2K\r${phase}:${event.state}${progress}${suffix}`)
    if (event.state === 'browser-ready' || event.state === 'translator-ready' || event.state === 'translator-translated')
      process.stdout.write('\n')
  },
})

const startedAt = Date.now()

try {
  console.log(`Chrome smoke test`)
  console.log(`  cacheDir: ${cacheDir}`)
  if (browserExecutablePath)
    console.log(`  executablePath: ${browserExecutablePath}`)
  console.log(`  visible: ${browserVisible}`)
  console.log(`  pair: ${sourceLocale} -> ${targetLocale}`)

  console.log('\n[1/2] preflight')
  console.log('  step: waiting for browser and bridge initialization')
  await translator.preflight({ sourceLocale, targetLocale })
  console.log('  preflight ok')

  console.log('\n[2/2] translate')
  console.log('  step: sending sample text through Translator API')
  const results = await translator.translate(['你好，世界'], { sourceLocale, targetLocale })
  console.log(`  result: ${results[0]?.translation ?? '(missing)'}`)
  console.log(`  observed states: ${observedStates.join(', ') || '(none)'}`)

  console.log(`\nDone in ${Date.now() - startedAt}ms`)
}
catch (error) {
  console.error('\nChrome smoke test failed')
  console.error(error instanceof Error ? error.message : String(error))
  if (error && typeof error === 'object' && 'cause' in error && error.cause)
    console.error('cause:', error.cause instanceof Error ? error.cause.message : String(error.cause))
  process.exitCode = 1
}
finally {
  await translator.dispose?.()
}
