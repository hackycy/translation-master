export type EventName = 'modelLoad' | 'translate' | 'error' | 'domTranslate'

export interface ModelLoadEvent {
  modelId: string
  progress: number
  state: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  file?: string
}

export interface TranslateEvent {
  text: string
  from: string
  to: string
  result?: string
  duration?: number
  model?: string
  cached?: boolean
}

export interface ErrorEvent {
  error: Error
  context?: string
}

export interface DOMTranslateEvent {
  phase: 'scanning' | 'translating' | 'rendering' | 'done' | 'cancelled'
  translatedGroups: number
  totalGroups: number
  currentBatch?: number
  totalBatches?: number
}

interface EventMap {
  modelLoad: ModelLoadEvent
  translate: TranslateEvent
  error: ErrorEvent
  domTranslate: DOMTranslateEvent
}

type Listener<T> = (event: T) => void

export class TranslatorEventEmitter {
  private listeners = new Map<string, Set<Listener<any>>>()

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(listener)
    return () => {
      this.listeners.get(event)?.delete(listener)
    }
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    this.listeners.get(event)?.delete(listener)
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(data)
      }
      catch (err) {
        console.error(`[translation-master] Error in ${event} listener:`, err)
      }
    })
  }

  removeAllListeners(event?: keyof EventMap): void {
    if (event) {
      this.listeners.delete(event)
    }
    else {
      this.listeners.clear()
    }
  }
}
