import { Translator } from 'translation-master'

// --- DOM refs ---
const langFrom = document.getElementById('lang-from') as HTMLSelectElement
const langTo = document.getElementById('lang-to') as HTMLSelectElement
const inputText = document.getElementById('input-text') as HTMLTextAreaElement
const btnTranslate = document.getElementById('btn-translate') as HTMLButtonElement
const btnCancel = document.getElementById('btn-cancel') as HTMLButtonElement
const translateStatus = document.getElementById('translate-status') as HTMLSpanElement
const translateResult = document.getElementById('translate-result') as HTMLDivElement

const detectInput = document.getElementById('detect-input') as HTMLInputElement
const btnDetect = document.getElementById('btn-detect') as HTMLButtonElement
const detectResult = document.getElementById('detect-result') as HTMLDivElement

const btnPreloadZhEn = document.getElementById('btn-preload-zh-en') as HTMLButtonElement
const btnPreloadEnZh = document.getElementById('btn-preload-en-zh') as HTMLButtonElement
const btnStats = document.getElementById('btn-stats') as HTMLButtonElement
const btnClearCache = document.getElementById('btn-clear-cache') as HTMLButtonElement
const btnDispose = document.getElementById('btn-dispose') as HTMLButtonElement
const statsDisplay = document.getElementById('stats-display') as HTMLDivElement

const logArea = document.getElementById('log-area') as HTMLDivElement

// --- Logger ---
function log(msg: string, level: 'info' | 'warn' | 'error' | 'progress' = 'info') {
  const line = document.createElement('div')
  line.className = level
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  logArea.appendChild(line)
  logArea.scrollTop = logArea.scrollHeight
}

// --- Translator instance ---
const translator = new Translator({
  // device defaults to 'wasm', no need to specify
  // ui defaults to true, toast progress bar shows automatically
  debug: true,
})

// Listen to events
translator.events.on('modelLoad', (e) => {
  if (e.state === 'progress') {
    translateStatus.textContent = `Loading model: ${e.progress.toFixed(1)}%`
    log(`Model ${e.modelId}: ${e.progress.toFixed(1)}%`, 'progress')
  }
  else if (e.state === 'done') {
    log(`Model ${e.modelId}: loaded`, 'info')
  }
})

translator.events.on('translate', (e) => {
  if (e.cached) {
    log(`Cache hit for "${e.text.slice(0, 30)}..." → ${e.to}`, 'info')
  }
})

translator.events.on('error', (e) => {
  log(`Error [${e.context ?? 'unknown'}]: ${e.error.message}`, 'error')
})

log('Translator initialized (device: wasm, ui: enabled, debug: true)')

// --- Translate ---
let abortController: AbortController | null = null

btnTranslate.addEventListener('click', async () => {
  const text = inputText.value.trim()
  if (!text)
    return

  const from = langFrom.value || undefined
  const to = langTo.value

  btnTranslate.disabled = true
  btnCancel.disabled = false
  translateResult.className = 'result mt-8'
  translateResult.textContent = ''
  translateStatus.textContent = 'Translating...'

  abortController = new AbortController()

  try {
    log(`Translating: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}" [${from ?? 'auto'} → ${to}]`)

    const result = await translator.translate(text, {
      from,
      to,
      signal: abortController.signal,
    })

    translateResult.textContent = result.text
    translateResult.classList.add('success')
    translateStatus.textContent = `Done in ${result.duration}ms | Model: ${result.model} | From: ${result.from}${result.confidence != null ? ` (${(result.confidence * 100).toFixed(0)}%)` : ''}${result.cached ? ' | Cached' : ''}`
    log(`Result: "${result.text}" (${result.duration}ms, model: ${result.model}${result.cached ? ', cached' : ''})`)
  }
  catch (err: any) {
    if (err?.message === 'Translation aborted') {
      translateResult.textContent = 'Translation cancelled.'
      translateStatus.textContent = 'Cancelled'
      log('Translation cancelled', 'warn')
    }
    else {
      translateResult.textContent = `Error: ${err?.message ?? err}`
      translateResult.classList.add('error')
      translateStatus.textContent = 'Error'
      log(`Error: ${err?.message ?? err}`, 'error')
    }
  }
  finally {
    btnTranslate.disabled = false
    btnCancel.disabled = true
    abortController = null
  }
})

btnCancel.addEventListener('click', () => {
  abortController?.abort()
})

// --- Detect ---
btnDetect.addEventListener('click', () => {
  const text = detectInput.value.trim()
  if (!text)
    return

  const result = translator.detect(text)
  detectResult.textContent = `Language: ${result.lang}\nConfidence: ${(result.confidence * 100).toFixed(1)}%`
  log(`Detected: ${result.lang} (${(result.confidence * 100).toFixed(1)}%)`)
})

// --- Model Management ---
btnPreloadZhEn.addEventListener('click', async () => {
  btnPreloadZhEn.disabled = true
  try {
    log('Preloading zh → en model...')
    await translator.preload('zh', 'en')
    log('Preload zh → en complete')
  }
  catch (err: any) {
    log(`Preload error: ${err?.message}`, 'error')
  }
  finally {
    btnPreloadZhEn.disabled = false
  }
})

btnPreloadEnZh.addEventListener('click', async () => {
  btnPreloadEnZh.disabled = true
  try {
    log('Preloading en → zh model...')
    await translator.preload('en', 'zh')
    log('Preload en → zh complete')
  }
  catch (err: any) {
    log(`Preload error: ${err?.message}`, 'error')
  }
  finally {
    btnPreloadEnZh.disabled = false
  }
})

btnStats.addEventListener('click', () => {
  const stats = translator.stats()
  statsDisplay.innerHTML = `
    <div class="stat-item"><div class="value">${stats.active}</div><div class="label">Active</div></div>
    <div class="stat-item"><div class="value">${stats.loading}</div><div class="label">Loading</div></div>
    <div class="stat-item"><div class="value">${stats.maxSize}</div><div class="label">Max Size</div></div>
    ${stats.models.map(m => `
      <div class="stat-item">
        <div class="value">${m.refCount}</div>
        <div class="label" title="${m.id}">${m.id.split('/').pop()}</div>
      </div>
    `).join('')}
  `
  log(`Pool stats: ${stats.active} active, ${stats.loading} loading`)
})

btnClearCache.addEventListener('click', async () => {
  btnClearCache.disabled = true
  try {
    await translator.clearCache()
    statsDisplay.innerHTML = ''
    translateResult.textContent = ''
    translateStatus.textContent = ''
    log('Translation result cache cleared')
  }
  catch (err: any) {
    log(`Clear cache error: ${err?.message}`, 'error')
  }
  finally {
    btnClearCache.disabled = false
  }
})

btnDispose.addEventListener('click', async () => {
  btnDispose.disabled = true
  try {
    await translator.dispose()
    statsDisplay.innerHTML = ''
    log('All models disposed, caches cleared, UI removed')
  }
  catch (err: any) {
    log(`Dispose error: ${err?.message}`, 'error')
  }
  finally {
    btnDispose.disabled = false
  }
})
