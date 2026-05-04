import { Translator } from 'translation-master'

// --- DOM refs ---
const domLangTo = document.getElementById('dom-lang-to') as HTMLSelectElement
const btnTranslatePage = document.getElementById('btn-translate-page') as HTMLButtonElement
const btnRestore = document.getElementById('btn-restore') as HTMLButtonElement
const btnTranslateHero = document.getElementById('btn-translate-hero') as HTMLButtonElement
const btnToggleObserver = document.getElementById('btn-toggle-observer') as HTMLButtonElement
const domStatus = document.getElementById('dom-status') as HTMLSpanElement
const btnAddItem = document.getElementById('btn-add-item') as HTMLButtonElement
const dynamicList = document.getElementById('dynamic-list') as HTMLUListElement

// --- Translator instance ---
const translator = new Translator({
  debug: true,
})

let observerActive = false
// eslint-disable-next-line unused-imports/no-unused-vars
let currentTargetLang = ''

// --- Status helpers ---
function setStatus(text: string, type: '' | 'translating' | 'done' | 'error' = '') {
  domStatus.textContent = text
  domStatus.className = `control-status${type ? ` ${type}` : ''}`
}

// --- Progress logging ---
translator.events.on('domTranslate', (e) => {
  if (e.phase === 'scanning') {
    setStatus('正在扫描页面...', 'translating')
  }
  else if (e.phase === 'translating') {
    const pct = e.totalGroups > 0 ? Math.round((e.translatedGroups / e.totalGroups) * 100) : 0
    setStatus(
      `翻译中 ${e.translatedGroups}/${e.totalGroups} (${pct}%) | 批次 ${e.currentBatch}/${e.totalBatches}`,
      'translating',
    )
  }
  else if (e.phase === 'rendering') {
    setStatus('正在回写译文...', 'translating')
  }
  else if (e.phase === 'done') {
    setStatus(`翻译完成，共 ${e.totalGroups} 个文本组`, 'done')
  }
  else if (e.phase === 'cancelled') {
    setStatus('翻译已取消', '')
  }
})

translator.events.on('modelLoad', (e) => {
  if (e.state === 'progress') {
    setStatus(`加载模型: ${e.modelId.split('/').pop()} ${e.progress.toFixed(1)}%`, 'translating')
  }
  else if (e.state === 'ready') {
    setStatus('模型就绪，开始翻译...', 'translating')
  }
})

translator.events.on('error', (e) => {
  setStatus(`错误: ${e.error.message}`, 'error')
})

setStatus('就绪')

// --- Translate entire page ---
btnTranslatePage.addEventListener('click', async () => {
  const to = domLangTo.value
  currentTargetLang = to

  btnTranslatePage.disabled = true
  btnRestore.disabled = true
  btnTranslateHero.disabled = true

  try {
    await translator.translatePage({
      to,
      debug: true,
      viewportPriority: true,
      translateAttributes: true,
      translateMeta: true,
      observe: true,
      debounceMs: 500,
      ignoreClasses: ['code-block'],
      ignoreIds: [],
      onProgress: (e) => {
        // Progress events are also emitted via translator.events
        if (e.phase === 'done') {
          btnRestore.disabled = false
          btnToggleObserver.disabled = false
          observerActive = true
          btnToggleObserver.textContent = '停止动态监听'
        }
      },
    })
  }
  catch (err: any) {
    setStatus(`翻译失败: ${err?.message}`, 'error')
  }
  finally {
    btnTranslatePage.disabled = false
    btnTranslateHero.disabled = false
  }
})

// --- Restore ---
btnRestore.addEventListener('click', () => {
  translator.restorePage()
  btnRestore.disabled = true
  observerActive = false
  btnToggleObserver.textContent = '启动动态监听'
  btnToggleObserver.disabled = true
  setStatus('已还原原文')
})

// --- Translate hero only ---
btnTranslateHero.addEventListener('click', async () => {
  const to = domLangTo.value
  const hero = document.getElementById('hero-section')
  if (!hero)
    return

  btnTranslateHero.disabled = true

  try {
    await translator.translatePage({
      to,
      root: hero,
      debug: true,
    })
    btnRestore.disabled = false
    setStatus(`Hero 区域已翻译为 ${to}`, 'done')
  }
  catch (err: any) {
    setStatus(`翻译失败: ${err?.message}`, 'error')
  }
  finally {
    btnTranslateHero.disabled = false
  }
})

// --- Toggle Observer ---
btnToggleObserver.addEventListener('click', () => {
  if (observerActive) {
    translator.stopDOMObserver()
    observerActive = false
    btnToggleObserver.textContent = '启动动态监听'
    setStatus('动态监听已停止')
  }
  else {
    translator.startDOMObserver({ debounceMs: 500 })
    observerActive = true
    btnToggleObserver.textContent = '停止动态监听'
    setStatus('动态监听已启动', 'done')
  }
})

// --- Dynamic content simulation ---
const dynamicMessages = [
  '用户 张三 刚刚完成了首次翻译',
  '系统检测到新的语言模型更新',
  '翻译缓存命中率已达 85%',
  '后台正在优化模型加载速度',
  '新增支持 5 种东南亚语言',
  '用户反馈：翻译质量非常准确',
  'WebGPU 加速模式已自动启用',
  '离线翻译模式运行正常',
  '批量翻译处理了 156 个文本节点',
  '可视区域优先翻译已生效',
]
let msgIndex = 0

function addDynamicItem() {
  const li = document.createElement('li')
  const msg = dynamicMessages[msgIndex % dynamicMessages.length]
  msgIndex++

  const now = new Date()
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`

  li.innerHTML = `${msg} <span class="time">${timeStr}</span>`
  dynamicList.appendChild(li)

  // Keep list manageable
  while (dynamicList.children.length > 15) {
    dynamicList.removeChild(dynamicList.firstChild!)
  }
}

btnAddItem.addEventListener('click', addDynamicItem)

// Auto-add items periodically to demonstrate observer
let autoAddTimer: ReturnType<typeof setInterval> | null = null

function startAutoAdd() {
  if (autoAddTimer)
    return
  autoAddTimer = setInterval(addDynamicItem, 4000)
}

// eslint-disable-next-line unused-imports/no-unused-vars
function stopAutoAdd() {
  if (autoAddTimer) {
    clearInterval(autoAddTimer)
    autoAddTimer = null
  }
}

// Start auto-adding after 3 seconds
setTimeout(startAutoAdd, 3000)
