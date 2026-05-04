import type { TextGroup } from './dom-types'

/**
 * Viewport-based priority sorting using IntersectionObserver.
 * Groups whose parent elements are visible in the viewport are prioritized
 * for translation over off-screen content.
 */
export class DOMViewport {
  private observer: IntersectionObserver | null = null
  private visibleElements = new Set<Element>()
  private initialized = false

  /**
   * Initialize the IntersectionObserver.
   * Must be called before sorting.
   */
  init(): void {
    if (this.initialized || typeof IntersectionObserver === 'undefined')
      return

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.visibleElements.add(entry.target)
          }
          else {
            this.visibleElements.delete(entry.target)
          }
        }
      },
      { threshold: 0 },
    )

    this.initialized = true
  }

  /**
   * Observe a set of elements to track their visibility.
   */
  observeElements(elements: Element[]): void {
    if (!this.observer)
      return

    for (const el of elements) {
      this.observer.observe(el)
    }
  }

  /**
   * Sort TextGroups so that visible viewport content comes first.
   * Off-screen content is pushed to the end.
   */
  sort(groups: TextGroup[]): TextGroup[] {
    if (!this.initialized) {
      return groups
    }

    // Split into visible and non-visible
    const visible: TextGroup[] = []
    const notVisible: TextGroup[] = []

    for (const group of groups) {
      if (this.isVisible(group.parentElement)) {
        visible.push(group)
      }
      else {
        notVisible.push(group)
      }
    }

    return [...visible, ...notVisible]
  }

  /**
   * Check if an element is currently visible in the viewport.
   */
  private isVisible(element: Element): boolean {
    if (this.visibleElements.has(element))
      return true

    // Also check parent chain — a text node is visible if any ancestor is visible
    let parent: Element | null = element
    while (parent) {
      if (this.visibleElements.has(parent))
        return true
      parent = parent.parentElement
    }

    // Fallback: use getBoundingClientRect for elements not yet observed
    try {
      const rect = element.getBoundingClientRect()
      return (
        rect.top < window.innerHeight
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.right > 0
      )
    }
    catch {
      return true // If getBoundingClientRect fails, assume visible
    }
  }

  /**
   * Disconnect the observer and clean up.
   */
  destroy(): void {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.visibleElements.clear()
    this.initialized = false
  }
}
