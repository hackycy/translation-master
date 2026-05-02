import type { ModelLoadEvent, TranslatorEventEmitter } from './event-emitter'

const STYLE_ID = 'translator-toast-style'
const CONTAINER_ID = 'translator-toast-container'

const CSS = `
#${CONTAINER_ID} {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.translator-toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: translator-toast-in 0.25s ease-out;
  max-width: 420px;
  background: var(--translator-toast-bg, #ffffff);
  color: var(--translator-toast-color, #333333);
  border: 1px solid var(--translator-toast-border, rgba(0, 0, 0, 0.08));
}

[data-theme="dark"] .translator-toast,
.translator-toast.dark {
  --translator-toast-bg: #1e1e1e;
  --translator-toast-color: #d4d4d4;
  --translator-toast-border: rgba(255, 255, 255, 0.1);
  --translator-toast-progress-bg: #333333;
  --translator-toast-progress-fill: #4a90d9;
  --translator-toast-close-hover: rgba(255, 255, 255, 0.1);
}

.translator-toast-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  border: 2px solid var(--translator-toast-progress-fill, #4a90d9);
  border-top-color: transparent;
  border-radius: 50%;
  animation: translator-spin 0.8s linear infinite;
}

.translator-toast-icon.done {
  border: none;
  animation: none;
}

.translator-toast-icon.done::after {
  content: '';
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--translator-toast-progress-fill, #4a90d9);
}

.translator-toast-body {
  flex: 1;
  min-width: 0;
}

.translator-toast-label {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.translator-toast-progress {
  margin-top: 6px;
  height: 3px;
  border-radius: 2px;
  background: var(--translator-toast-progress-bg, #e8e8e8);
  overflow: hidden;
}

.translator-toast-progress-bar {
  height: 100%;
  border-radius: 2px;
  background: var(--translator-toast-progress-fill, #4a90d9);
  transition: width 0.2s ease;
  width: 0%;
}

.translator-toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--translator-toast-color, #999);
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: background 0.15s;
}

.translator-toast-close:hover {
  background: var(--translator-toast-close-hover, rgba(0, 0, 0, 0.06));
}

.translator-toast.fade-out {
  animation: translator-toast-out 0.2s ease-in forwards;
}

@keyframes translator-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes translator-toast-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-8px); }
}

@keyframes translator-spin {
  to { transform: rotate(360deg); }
}
`

function injectStyles(): void {
  if (typeof document === 'undefined')
    return
  if (document.getElementById(STYLE_ID))
    return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

function getOrCreateContainer(): HTMLElement {
  let container = document.getElementById(CONTAINER_ID)
  if (!container) {
    container = document.createElement('div')
    container.id = CONTAINER_ID
    document.body.appendChild(container)
  }
  return container
}

function detectDarkMode(): boolean {
  if (typeof document === 'undefined')
    return false
  return document.documentElement.getAttribute('data-theme') === 'dark'
    || document.documentElement.classList.contains('dark')
    || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

export class ToastUI {
  private toast: HTMLElement | null = null
  private labelEl: HTMLElement | null = null
  private progressBar: HTMLElement | null = null
  private iconEl: HTMLElement | null = null
  private dismissTimer: ReturnType<typeof setTimeout> | null = null
  private readyReceived = false
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribe: (() => void)[] = []
  private visible = false
  private filesCompleted = 0
  private currentFileProgress = 0
  private currentModelId = ''

  constructor(
    private events: TranslatorEventEmitter,
    private enabled: boolean = true,
  ) {
    if (!enabled)
      return
    injectStyles()
    this.bindEvents()
  }

  private bindEvents(): void {
    this.unsubscribe.push(
      this.events.on('modelLoad', e => this.handleModelLoad(e)),
    )
  }

  private handleModelLoad(event: ModelLoadEvent): void {
    if (event.state === 'initiate') {
      // Reset counters when a new model starts loading
      if (event.modelId !== this.currentModelId) {
        this.filesCompleted = 0
        this.currentModelId = event.modelId
      }
      this.readyReceived = false
      this.clearFallbackTimer()
      this.currentFileProgress = 0
      this.show(event.modelId)
    }
    else if (event.state === 'progress' || event.state === 'download') {
      this.currentFileProgress = event.progress
      this.updateProgress(event.modelId)
    }
    else if (event.state === 'done') {
      this.filesCompleted++
      this.currentFileProgress = 0
      this.updateProgress(event.modelId)
      this.startFallbackTimer(event.modelId)
    }
    else if (event.state === 'ready') {
      this.readyReceived = true
      this.clearFallbackTimer()
      this.showDone(event.modelId)
    }
  }

  private startFallbackTimer(modelId: string): void {
    if (this.readyReceived)
      return
    if (this.fallbackTimer)
      clearTimeout(this.fallbackTimer)
    this.fallbackTimer = setTimeout(() => {
      if (!this.readyReceived) {
        this.showDone(modelId)
      }
      this.fallbackTimer = null
    }, 3000)
  }

  private clearFallbackTimer(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
  }

  private show(modelId: string): void {
    if (!this.enabled || typeof document === 'undefined')
      return

    this.clearDismissTimer()

    if (!this.toast) {
      const container = getOrCreateContainer()
      const toast = document.createElement('div')
      toast.className = `translator-toast${detectDarkMode() ? ' dark' : ''}`

      const icon = document.createElement('div')
      icon.className = 'translator-toast-icon'

      const body = document.createElement('div')
      body.className = 'translator-toast-body'

      const label = document.createElement('div')
      label.className = 'translator-toast-label'

      const progressWrap = document.createElement('div')
      progressWrap.className = 'translator-toast-progress'

      const progressBar = document.createElement('div')
      progressBar.className = 'translator-toast-progress-bar'

      progressWrap.appendChild(progressBar)
      body.appendChild(label)
      body.appendChild(progressWrap)

      const close = document.createElement('button')
      close.className = 'translator-toast-close'
      close.textContent = '×'
      close.onclick = () => this.dismiss()

      toast.appendChild(icon)
      toast.appendChild(body)
      toast.appendChild(close)
      container.appendChild(toast)

      this.toast = toast
      this.labelEl = label
      this.progressBar = progressBar
      this.iconEl = icon
    }

    const shortId = modelId.split('/').pop() ?? modelId
    const suffix = this.filesCompleted > 0 ? ` (${this.filesCompleted} files loaded)` : ''
    this.labelEl!.textContent = `Loading model: ${shortId} ${this.currentFileProgress.toFixed(0)}%${suffix}`
    this.progressBar!.style.width = `${this.currentFileProgress}%`
    this.iconEl!.className = 'translator-toast-icon'
    this.toast.classList.remove('fade-out')
    this.visible = true
  }

  private updateProgress(modelId: string): void {
    if (!this.toast || !this.visible)
      return
    const shortId = modelId.split('/').pop() ?? modelId
    const suffix = this.filesCompleted > 0 ? ` (${this.filesCompleted} files loaded)` : ''
    this.labelEl!.textContent = `Loading model: ${shortId} ${this.currentFileProgress.toFixed(0)}%${suffix}`
    this.progressBar!.style.width = `${this.currentFileProgress}%`
  }

  private showDone(modelId: string): void {
    if (!this.toast || !this.visible)
      return
    const shortId = modelId.split('/').pop() ?? modelId
    this.labelEl!.textContent = `Model ready: ${shortId}`
    this.progressBar!.style.width = '100%'
    this.iconEl!.className = 'translator-toast-icon done'
    this.dismissTimer = setTimeout(() => this.dismiss(), 2000)
  }

  private dismiss(): void {
    if (!this.toast)
      return
    this.clearDismissTimer()
    this.toast.classList.add('fade-out')
    setTimeout(() => {
      this.toast?.remove()
      this.toast = null
      this.labelEl = null
      this.progressBar = null
      this.iconEl = null
      this.visible = false
    }, 200)
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer)
      this.dismissTimer = null
    }
    this.clearFallbackTimer()
  }

  destroy(): void {
    this.unsubscribe.forEach(fn => fn())
    this.unsubscribe = []
    this.clearDismissTimer()
    this.clearFallbackTimer()
    this.toast?.remove()
    this.toast = null
    this.visible = false
  }
}
