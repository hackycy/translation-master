import type { NodeOriginalData, TextFragment, TextGroup } from './dom-types'

/**
 * WeakMap storing original node data for restore functionality.
 * Keyed by the DOM node (Text or Attr), values hold original/translated text.
 */
const originalData = new WeakMap<Text | Attr, NodeOriginalData>()

/**
 * DOM write-back engine. Handles atomic replacement of translated text
 * within TextGroups, including complex cases with mixed inline elements.
 *
 * Strategy: placeholder-based approach
 * 1. Insert unique placeholders into the merged text for each fragment
 * 2. Translate the text containing placeholders
 * 3. Split the translated text by placeholders
 * 4. Write each segment back to its corresponding DOM node
 */
export class DOMRenderer {
  private debug: boolean

  constructor(debug = false) {
    this.debug = debug
  }

  /**
   * Write translated text back to a TextGroup atomically.
   *
   * @param group The original TextGroup
   * @param translatedText The translated merged text
   */
  writeBack(group: TextGroup, translatedText: string): void {
    if (group.fragments.length === 0)
      return

    // Single fragment — direct replacement
    if (group.fragments.length === 1) {
      this.writeFragment(group.fragments[0], translatedText)
      return
    }

    // Multiple fragments — use placeholder-based splitting
    this.writeMultiFragment(group, translatedText)
  }

  /**
   * Handle multi-fragment write-back using placeholder markers.
   *
   * Example:
   *   <h1>你好<b>世</b>界</h1>
   *   Fragments: ["你好", "世界"]
   *   Merged: "你好世界"
   *   Placeholders: "你好\x00TM0\x00世界\x00TM1\x00"
   *   Translated: "Hello \x00TM0\x00World\x00TM1\x00"
   *   Split: ["Hello ", "World"]
   *   Write: "Hello " → first text node, "World" → last text node
   */
  private writeMultiFragment(group: TextGroup, translatedText: string): void {
    const fragments = group.fragments

    // Build a regex to find placeholders in the translated text
    // Placeholders have the form \x00TM<index>\x00
    const placeholderMap = new Map<string, number>()
    for (let i = 0; i < fragments.length; i++) {
      placeholderMap.set(this.placeholder(i), i)
    }

    // Try to find placeholders in the translated text
    const segments = this.splitByPlaceholders(translatedText, fragments.length)

    if (segments.length === fragments.length) {
      // Perfect split — write each segment to its fragment
      for (let i = 0; i < fragments.length; i++) {
        this.writeFragment(fragments[i], segments[i])
      }
      return
    }

    // Fallback: proportional splitting
    // If placeholders were lost during translation, split proportionally
    this.proportionalWriteBack(fragments, translatedText)
  }

  /**
   * Write a single fragment's translated text back to its DOM node.
   */
  private writeFragment(fragment: TextFragment, translatedText: string): void {
    const { node, nodeType, originalText } = fragment

    // Save original data if not already saved
    if (!originalData.has(node)) {
      originalData.set(node, {
        originalValue: node.nodeValue ?? '',
      })
    }

    const data = originalData.get(node)!
    data.translatedValue = translatedText
    data.translatedAt = Date.now()

    if (nodeType === 'attribute') {
      // For attribute nodes, set the value directly
      const attr = node as Attr
      if (attr.ownerElement) {
        attr.value = translatedText
      }
    }
    else {
      // For text nodes, set nodeValue
      node.nodeValue = translatedText
    }

    if (this.debug) {
      console.log(
        `[translation-master] Rendered: "${originalText}" → "${translatedText}"`,
        node,
      )
    }
  }

  /**
   * Split translated text by placeholder markers.
   * Returns an array of segments, one per fragment.
   * If placeholders are not found, returns empty array.
   */
  private splitByPlaceholders(text: string, fragmentCount: number): string[] {
    const segments: string[] = []
    let remaining = text
    let foundAll = true

    for (let i = 0; i < fragmentCount; i++) {
      const ph = this.placeholder(i)
      const idx = remaining.indexOf(ph)

      if (idx === -1) {
        // Placeholder not found — translation may have altered it
        foundAll = false
        break
      }

      segments.push(remaining.substring(0, idx))
      remaining = remaining.substring(idx + ph.length)
    }

    if (!foundAll) {
      return []
    }

    // Add the remaining text after the last placeholder (if any)
    // This shouldn't normally happen, but handle gracefully
    if (remaining.length > 0) {
      // Append to last segment
      segments[segments.length - 1] += remaining
    }

    return segments
  }

  /**
   * Fallback: split translated text proportionally based on original fragment lengths.
   * Used when placeholders are lost during translation.
   */
  private proportionalWriteBack(fragments: TextFragment[], translatedText: string): void {
    const totalOriginalLength = fragments.reduce((sum, f) => sum + f.text.length, 0)
    if (totalOriginalLength === 0) {
      // All fragments are empty — nothing to do
      return
    }

    let offset = 0
    for (let i = 0; i < fragments.length; i++) {
      const fragment = fragments[i]
      const ratio = fragment.text.length / totalOriginalLength

      if (i === fragments.length - 1) {
        // Last fragment gets all remaining text
        this.writeFragment(fragment, translatedText.substring(offset))
      }
      else {
        const end = offset + Math.round(ratio * translatedText.length)
        this.writeFragment(fragment, translatedText.substring(offset, end))
        offset = end
      }
    }
  }

  /**
   * Generate a unique placeholder for a fragment index.
   * Uses Unicode control characters that are unlikely to appear in normal text
   * and unlikely to be altered by translation models.
   */
  private placeholder(index: number): string {
    return `\x00TM${index}\x00`
  }

  /**
   * Insert placeholders into the merged text for each fragment.
   * This creates the text that will be sent for translation.
   *
   * @param group The TextGroup to prepare
   * @returns Text with placeholders inserted after each fragment
   */
  prepareForTranslation(group: TextGroup): string {
    if (group.fragments.length <= 1) {
      return group.text
    }

    let result = ''
    for (let i = 0; i < group.fragments.length; i++) {
      const fragment = group.fragments[i]
      // Add the text from offset to the end of this fragment
      const fragmentEnd = fragment.offset + fragment.text.length
      result += group.text.substring(
        i === 0 ? fragment.offset : group.fragments[i - 1].offset + group.fragments[i - 1].text.length,
        fragmentEnd,
      )
      result += this.placeholder(i)
    }

    return result
  }

  /**
   * Restore a specific node to its original value.
   */
  restoreNode(node: Text | Attr): boolean {
    const data = originalData.get(node)
    if (!data)
      return false

    if (node instanceof Attr) {
      node.value = data.originalValue
    }
    else {
      node.nodeValue = data.originalValue
    }

    if (this.debug) {
      console.log(`[translation-master] Restored node to: "${data.originalValue}"`, node)
    }

    return true
  }

  /**
   * Check if a node has been translated (has stored original data).
   */
  hasTranslation(node: Text | Attr): boolean {
    return originalData.has(node)
  }

  /**
   * Get the original data for a node.
   */
  getOriginalData(node: Text | Attr): NodeOriginalData | undefined {
    return originalData.get(node)
  }

  /**
   * Get the last translation timestamp for a node (used for cycle detection).
   */
  getLastTranslatedAt(node: Text | Attr): number | undefined {
    return originalData.get(node)?.translatedAt
  }

  /**
   * Update the translation timestamp for a node (used by observer cycle detection).
   */
  markTranslated(node: Text | Attr): void {
    const data = originalData.get(node)
    if (data) {
      data.translatedAt = Date.now()
    }
  }
}
