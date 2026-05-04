import type { DOMTranslatorOptions, TextFragment, TextGroup } from './dom-types'
import {
  BLOCK_ELEMENTS,
  DEFAULT_IGNORE_TAGS,
  DEFAULT_TRANSLATABLE_ATTRIBUTES,
  META_PROPERTY_PATTERNS,
  META_TRANSLATE_PATTERNS,
} from './dom-types'

/**
 * Collects translatable text nodes from the DOM using TreeWalker,
 * then intelligently merges consecutive text nodes into TextGroups.
 *
 * A TextGroup is the smallest translation unit — all fragments in a group
 * are translated together and written back atomically.
 */
export class DOMWalker {
  private ignoreTags: Set<string>
  private ignoreClasses: Set<string>
  private ignoreIds: Set<string>
  private filter?: (node: Text | Attr) => boolean
  private attributeRules: Record<string, string[]>
  private translateAttributes: boolean
  private translateMeta: boolean
  private debug: boolean

  constructor(options: DOMTranslatorOptions) {
    this.ignoreTags = new Set(DEFAULT_IGNORE_TAGS)
    if (options.ignoreTags) {
      for (const tag of options.ignoreTags)
        this.ignoreTags.add(tag.toLowerCase())
    }
    this.ignoreClasses = new Set(options.ignoreClasses)
    this.ignoreIds = new Set(options.ignoreIds)
    this.filter = options.filter
    this.attributeRules = options.attributeRules ?? {}
    this.translateAttributes = options.translateAttributes !== false
    this.translateMeta = options.translateMeta !== false
    this.debug = options.debug ?? false
  }

  /**
   * Scan a root element and return all TextGroups for translation.
   */
  scan(root: Element): TextGroup[] {
    const groups: TextGroup[] = []
    const textNodes = this.collectTextNodes(root)

    if (this.debug) {
      console.log(`[translation-master] Scanned ${textNodes.length} translatable text nodes`)
    }

    // Merge consecutive text nodes into groups
    this.mergeIntoGroups(textNodes, groups)

    // Collect translatable attributes
    if (this.translateAttributes || Object.keys(this.attributeRules).length > 0) {
      this.collectAttributes(root, groups)
    }

    // Collect meta tags
    if (this.translateMeta) {
      this.collectMetaTags(groups)
    }

    // Filter out empty groups
    return groups.filter(g => g.text.trim().length > 0)
  }

  /**
   * Use TreeWalker to collect all translatable text nodes.
   */
  private collectTextNodes(root: Element): Text[] {
    const nodes: Text[] = []
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node: Node): number => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return this.acceptElement(node as Element)
          }
          if (node.nodeType === Node.TEXT_NODE) {
            return this.acceptText(node as Text)
          }
          return NodeFilter.FILTER_REJECT
        },
      },
    )

    let node: Node | null = walker.nextNode()
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) {
        nodes.push(node as Text)
      }
      node = walker.nextNode()
    }

    return nodes
  }

  /**
   * Filter for element nodes — determines whether to skip or descend into an element.
   */
  private acceptElement(element: Element): number {
    const tag = element.tagName.toLowerCase()

    // Skip ignored tags entirely (don't descend into them)
    if (this.ignoreTags.has(tag)) {
      return NodeFilter.FILTER_REJECT
    }

    if (this.shouldIgnoreElement(element)) {
      return NodeFilter.FILTER_REJECT
    }

    return NodeFilter.FILTER_SKIP // Skip element itself but descend into children
  }

  /**
   * Filter for text nodes — determines whether a text node is translatable.
   */
  private acceptText(textNode: Text): number {
    const text = textNode.nodeValue
    if (!text || text.trim().length === 0) {
      return NodeFilter.FILTER_REJECT
    }

    // Skip if parent is an ignored tag (should already be caught by acceptElement)
    const parent = textNode.parentElement
    if (parent) {
      const parentTag = parent.tagName.toLowerCase()
      if (this.ignoreTags.has(parentTag)) {
        return NodeFilter.FILTER_REJECT
      }

      // Skip if parent has data-no-translate
      if (parent.hasAttribute('data-no-translate')) {
        return NodeFilter.FILTER_REJECT
      }

      // Skip if parent has translate="no"
      if (parent.getAttribute('translate') === 'no') {
        return NodeFilter.FILTER_REJECT
      }
    }

    // Custom filter
    if (this.filter && !this.filter(textNode)) {
      return NodeFilter.FILTER_REJECT
    }

    return NodeFilter.FILTER_ACCEPT
  }

  /**
   * Merge consecutive text nodes into TextGroups.
   *
   * Rules:
   * - Text nodes under the same parent element are candidates for merging
   * - If two consecutive text nodes have only inline elements between them,
   *   they belong to the same group
   * - Block-level elements create group boundaries
   * - Each fragment records its offset within the merged text
   */
  private mergeIntoGroups(textNodes: Text[], groups: TextGroup[]): void {
    if (textNodes.length === 0)
      return

    // Group text nodes by their closest block-level ancestor
    let currentParent: Element | null = null
    let currentFragments: TextFragment[] = []
    let currentText = ''

    for (const textNode of textNodes) {
      const parent = this.getBlockParent(textNode)

      if (parent !== currentParent) {
        // New group boundary
        if (currentFragments.length > 0 && currentText.trim().length > 0) {
          groups.push({
            text: currentText,
            fragments: currentFragments,
            parentElement: currentParent!,
          })
        }
        currentParent = parent
        currentFragments = []
        currentText = ''
      }

      const text = textNode.nodeValue ?? ''
      if (text.trim().length === 0)
        continue

      // Check if there are block elements between this node and the previous fragment
      if (currentFragments.length > 0) {
        const lastFragment = currentFragments[currentFragments.length - 1]
        if (this.hasBlockElementBetween(lastFragment.node as Text, textNode)) {
          // Block element found — flush current group and start new one
          if (currentText.trim().length > 0) {
            groups.push({
              text: currentText,
              fragments: currentFragments,
              parentElement: currentParent!,
            })
          }
          currentFragments = []
          currentText = ''
        }
      }

      const offset = currentText.length
      currentFragments.push({
        text,
        node: textNode,
        nodeType: 'text',
        originalText: text,
        offset,
      })
      currentText += text
    }

    // Flush last group
    if (currentFragments.length > 0 && currentText.trim().length > 0) {
      groups.push({
        text: currentText,
        fragments: currentFragments,
        parentElement: currentParent!,
      })
    }
  }

  /**
   * Get the closest block-level ancestor of a text node.
   * This is used to determine group boundaries.
   */
  private getBlockParent(node: Text): Element {
    let parent = node.parentElement
    while (parent) {
      const tag = parent.tagName.toLowerCase()
      if (BLOCK_ELEMENTS.has(tag)) {
        return parent
      }
      parent = parent.parentElement
    }
    return document.body // fallback
  }

  /**
   * Check if there is a block-level element between two nodes in the DOM tree.
   */
  private hasBlockElementBetween(nodeA: Text, nodeB: Text): boolean {
    // Walk from nodeA to nodeB using nextSibling/parentNode
    // If we encounter a block element, return true
    let current: Node | null = nodeA

    while (current && current !== nodeB) {
      // Check next sibling first
      let next: Node | null = current.nextSibling
      if (!next) {
        // Go up to parent and check next sibling
        next = current.parentNode?.nextSibling ?? null
        current = current.parentNode
        if (current && current !== nodeB) {
          const tag = (current as Element).tagName?.toLowerCase()
          if (tag && BLOCK_ELEMENTS.has(tag)) {
            return true
          }
        }
      }

      if (next) {
        if (next === nodeB)
          return false
        if (next.nodeType === Node.ELEMENT_NODE) {
          const tag = (next as Element).tagName.toLowerCase()
          if (BLOCK_ELEMENTS.has(tag)) {
            return true
          }
        }
        current = next
      }
      else {
        break
      }
    }

    return false
  }

  /**
   * Collect translatable attributes (title, alt, placeholder, etc.)
   * and create TextGroups for them.
   *
   * Uses targeted CSS selectors instead of querySelectorAll('*') for performance.
   */
  private collectAttributes(root: Element, groups: TextGroup[]): void {
    // Merge default and custom attribute rules
    const rules: Record<string, string[]> = {}

    if (this.translateAttributes) {
      for (const [tag, attrs] of Object.entries(DEFAULT_TRANSLATABLE_ATTRIBUTES)) {
        rules[tag] = [...(rules[tag] ?? []), ...attrs]
      }
    }

    for (const [tag, attrs] of Object.entries(this.attributeRules)) {
      rules[tag] = [...(rules[tag] ?? []), ...attrs]
    }

    // Build targeted CSS selectors instead of querying all elements
    // Collect all unique attribute names across all rules
    const allAttrNames = new Set<string>()
    for (const attrs of Object.values(rules)) {
      for (const attr of attrs)
        allAttrNames.add(attr)
    }

    // Build a combined selector: [title], [alt], [placeholder], input[placeholder], etc.
    const selectors: string[] = []
    const tagSpecificSelectors: string[] = []

    for (const [tag, attrs] of Object.entries(rules)) {
      for (const attr of attrs) {
        if (tag === '*') {
          selectors.push(`[${attr}]`)
        }
        else {
          tagSpecificSelectors.push(`${tag}[${attr}]`)
        }
      }
    }

    // Combine and deduplicate
    const combinedSelector = [...new Set([...selectors, ...tagSpecificSelectors])].join(', ')

    if (combinedSelector.length === 0)
      return

    // Query only elements that actually have translatable attributes
    const elements = Array.from(root.querySelectorAll(combinedSelector))

    // Also collect wildcard (*) attributes from all elements that have them
    const wildcardAttrs = rules['*'] ?? []

    for (const element of elements) {
      const tag = element.tagName.toLowerCase()

      // Determine which attributes apply to this element
      const applicableAttrs = new Set<string>()
      // Tag-specific rules
      if (rules[tag]) {
        for (const attr of rules[tag])
          applicableAttrs.add(attr)
      }
      // Wildcard rules
      for (const attr of wildcardAttrs)
        applicableAttrs.add(attr)

      for (const attrName of applicableAttrs) {
        const attrNode = element.getAttributeNode(attrName)
        if (!attrNode)
          continue

        const value = attrNode.value
        if (!value || value.trim().length === 0)
          continue

        if (this.shouldIgnoreElement(element))
          continue

        if (this.filter && !this.filter(attrNode))
          continue

        groups.push({
          text: value,
          fragments: [{
            text: value,
            node: attrNode,
            nodeType: 'attribute',
            attributeName: attrName,
            originalText: value,
            offset: 0,
          }],
          parentElement: element,
        })
      }

      // Special handling for input/textarea value
      if (tag === 'input' || tag === 'textarea') {
        const valueAttr = rules[tag]?.includes('value')
        if (valueAttr) {
          const value = (element as HTMLInputElement | HTMLTextAreaElement).value
          if (value && value.trim().length > 0 && !this.shouldIgnoreElement(element)) {
            const valueAttrNode = element.getAttributeNode('value')
            if (valueAttrNode) {
              groups.push({
                text: value,
                fragments: [{
                  text: value,
                  node: valueAttrNode,
                  nodeType: 'attribute',
                  attributeName: 'value',
                  originalText: value,
                  offset: 0,
                }],
                parentElement: element,
              })
            }
          }
        }
      }
    }
  }

  /**
   * Collect meta tags for translation.
   */
  private collectMetaTags(groups: TextGroup[]): void {
    const metas = Array.from(document.querySelectorAll('meta'))
    for (const meta of metas) {
      const name = (meta.getAttribute('name') ?? '').toLowerCase()
      const property = (meta.getAttribute('property') ?? '').toLowerCase()

      const shouldTranslate
        = META_TRANSLATE_PATTERNS.includes(name)
          || META_PROPERTY_PATTERNS.includes(property)

      if (!shouldTranslate)
        continue

      const contentAttr = meta.getAttributeNode('content')
      if (!contentAttr)
        continue

      const value = contentAttr.value
      if (!value || value.trim().length === 0)
        continue

      groups.push({
        text: value,
        fragments: [{
          text: value,
          node: contentAttr,
          nodeType: 'attribute',
          attributeName: 'content',
          originalText: value,
          offset: 0,
        }],
        parentElement: meta,
      })
    }
  }

  /**
   * Check if an element should be ignored based on class/id/no-translate rules.
   */
  private shouldIgnoreElement(element: Element): boolean {
    if (element.hasAttribute('data-no-translate'))
      return true
    if (element.getAttribute('translate') === 'no')
      return true

    if (this.hasIgnoredClass(element))
      return true

    if (this.ignoreIds.size > 0 && element.id && this.ignoreIds.has(element.id)) {
      return true
    }

    return false
  }

  /**
   * Check if an element has any class in the ignore set.
   */
  private hasIgnoredClass(element: Element): boolean {
    if (this.ignoreClasses.size === 0)
      return false
    const className = element.className
    if (!className)
      return false
    const classes = typeof className === 'string' ? className.split(/\s+/) : []
    for (const cls of classes) {
      if (this.ignoreClasses.has(cls))
        return true
    }
    return false
  }
}
