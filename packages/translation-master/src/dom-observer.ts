import type { DOMRenderer } from './dom-renderer'
import type { DOMWalker } from './dom-walker'

/**
 * MutationObserver wrapper with debouncing and cycle detection.
 *
 * Watches for DOM changes and triggers incremental translation for new content.
 * Includes safeguards against the translate→framework-restore→re-translate loop
 * common in Vue/React applications.
 */
export class DOMObserver {
  private observer: MutationObserver | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number
  private walker: DOMWalker
  private renderer: DOMRenderer
  private translateCallback: (elements: Element[]) => Promise<void>
  private running = false
  private root: Element = document.documentElement
  private _pendingElements: Set<Element> | null = null

  /** Time window (ms) within which a translated node's changes are ignored */
  private static readonly CYCLE_THRESHOLD_MS = 500

  constructor(
    walker: DOMWalker,
    renderer: DOMRenderer,
    translateCallback: (elements: Element[]) => Promise<void>,
    debounceMs = 300,
  ) {
    this.walker = walker
    this.renderer = renderer
    this.translateCallback = translateCallback
    this.debounceMs = debounceMs
  }

  /**
   * Start observing DOM changes on the given root element.
   */
  start(root: Element = document.documentElement): void {
    if (this.running)
      return

    this.root = root
    this.observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations)
    })

    this.observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
      attributes: true,
      attributeFilter: ['title', 'alt', 'placeholder', 'content'],
      attributeOldValue: true,
    })

    this.running = true
  }

  /**
   * Stop observing DOM changes.
   */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.clearDebounce()
    this.running = false
  }

  /**
   * Whether the observer is currently running.
   */
  isActive(): boolean {
    return this.running
  }

  /**
   * Handle a batch of mutations. Collects changed elements and triggers
   * a debounced incremental translation.
   */
  private handleMutations(mutations: MutationRecord[]): void {
    const changedElements = new Set<Element>()

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        // New nodes added
        for (let ni = 0; ni < mutation.addedNodes.length; ni++) {
          const node = mutation.addedNodes[ni]
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element
            if (!this.isRecentlyTranslated(el)) {
              changedElements.add(el)
            }
          }
          else if (node.nodeType === Node.TEXT_NODE) {
            const parent = (node as Text).parentElement
            if (parent && !this.isRecentlyTranslated(parent)) {
              changedElements.add(parent)
            }
          }
        }
      }
      else if (mutation.type === 'characterData') {
        // Text content changed
        const textNode = mutation.target as Text
        if (this.isRecentlyTranslated(textNode)) {
          continue
        }
        const parent = textNode.parentElement
        if (parent) {
          changedElements.add(parent)
        }
      }
      else if (mutation.type === 'attributes') {
        // Attribute changed (title, alt, placeholder, etc.)
        const element = mutation.target as Element
        if (this.isRecentlyTranslated(element)) {
          continue
        }
        changedElements.add(element)
      }
    }

    if (changedElements.size === 0)
      return

    // Debounce the translation trigger
    this.debounceTranslate([...changedElements])
  }

  /**
   * Check if a node was recently translated by our renderer.
   * This prevents the translate→restore→translate cycle.
   */
  private isRecentlyTranslated(node: Text | Element): boolean {
    const now = Date.now()

    if (node instanceof Text) {
      const lastTranslated = this.renderer.getLastTranslatedAt(node)
      if (lastTranslated && (now - lastTranslated) < DOMObserver.CYCLE_THRESHOLD_MS) {
        return true
      }
    }

    if (node instanceof Element) {
      // Check all child text nodes
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      let textNode: Node | null = walker.nextNode()
      while (textNode) {
        const lastTranslated = this.renderer.getLastTranslatedAt(textNode as Text)
        if (lastTranslated && (now - lastTranslated) < DOMObserver.CYCLE_THRESHOLD_MS) {
          return true
        }
        textNode = walker.nextNode()
      }
    }

    return false
  }

  /**
   * Debounced translation trigger.
   * Collects elements from multiple mutation callbacks and translates them together.
   */
  private debounceTranslate(elements: Element[]): void {
    // Merge with pending elements
    if (!this._pendingElements) {
      this._pendingElements = new Set()
    }
    for (const el of elements) {
      this._pendingElements.add(el)
    }

    this.clearDebounce()
    this.debounceTimer = setTimeout(async () => {
      const pending = this._pendingElements
      this._pendingElements = null

      if (pending && pending.size > 0) {
        try {
          await this.translateCallback([...pending])
        }
        catch (err) {
          console.error('[translation-master] Observer translation error:', err)
        }
      }
    }, this.debounceMs)
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /**
   * Destroy the observer and clean up all resources.
   */
  destroy(): void {
    this.stop()
    this._pendingElements = null
  }
}
