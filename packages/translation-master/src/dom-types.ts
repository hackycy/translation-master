/** DOM translation configuration */
export interface DOMTranslatorOptions {
  /** Target language (required) */
  to: string
  /** Source language, auto-detected if omitted */
  from?: string
  /** Tags to ignore (lowercase). Defaults include script, style, code, pre, etc. */
  ignoreTags?: string[]
  /** Class names to ignore */
  ignoreClasses?: string[]
  /** Element IDs to ignore */
  ignoreIds?: string[]
  /** Custom filter function. Return true to translate the node. */
  filter?: (node: Text | Attr) => boolean
  /** Custom attribute translation rules: { tagName: [attrName, ...] } */
  attributeRules?: Record<string, string[]>
  /** Whether to translate title/alt/placeholder attributes. Default true */
  translateAttributes?: boolean
  /** Whether to translate meta tags (keywords, description, og:*). Default true */
  translateMeta?: boolean
  /** Enable MutationObserver for dynamic content. Default false */
  observe?: boolean
  /** Observer debounce interval in ms. Default 300 */
  debounceMs?: number
  /** Use Web Worker for inference. Default false */
  useWorker?: boolean
  /** Prioritize visible viewport content. Default true */
  viewportPriority?: boolean
  /** Debug mode with console logging. Default false */
  debug?: boolean
  /** Translation progress callback */
  onProgress?: (event: DOMTranslateProgressEvent) => void
  /** Abort signal */
  signal?: AbortSignal
}

/** DOM translation progress event */
export interface DOMTranslateProgressEvent {
  /** Current phase */
  phase: 'scanning' | 'translating' | 'rendering' | 'done' | 'cancelled'
  /** Number of text nodes scanned */
  scannedNodes?: number
  /** Number of text groups translated so far */
  translatedGroups?: number
  /** Total text groups to translate */
  totalGroups?: number
  /** Current batch number */
  currentBatch?: number
  /** Total number of batches */
  totalBatches?: number
}

/**
 * A text group is a translation unit.
 * It merges consecutive text nodes under the same parent
 * that are only separated by inline elements.
 */
export interface TextGroup {
  /** Merged full text for translation */
  text: string
  /** Individual text fragments within the group */
  fragments: TextFragment[]
  /** Parent element for atomic write-back */
  parentElement: Element
  /** Detected source language */
  detectedLang?: string
}

/**
 * A text fragment corresponds to a single DOM text node or attribute.
 */
export interface TextFragment {
  /** Fragment text */
  text: string
  /** Corresponding DOM node (text node or attribute node) */
  node: Text | Attr
  /** Node type */
  nodeType: 'text' | 'attribute'
  /** Attribute name (only for attribute type) */
  attributeName?: string
  /** Original text before translation (for restore) */
  originalText: string
  /** Start offset within the merged group text */
  offset: number
}

/** Stored original data for a node, used for restore */
export interface NodeOriginalData {
  /** Original nodeValue */
  originalValue: string
  /** Translated value */
  translatedValue?: string
  /** Timestamp of last translation (for cycle detection) */
  translatedAt?: number
}

/** Default tags that should never be translated */
export const DEFAULT_IGNORE_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'svg',
  'canvas',
  'code',
  'pre',
  'kbd',
  'samp',
  'var',
  'math',
  'template',
  'iframe',
  'object',
  'embed',
  'applet',
])

/** Block-level elements that cause text group boundaries */
export const BLOCK_ELEMENTS = new Set([
  'div',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'tfoot',
  'table',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'blockquote',
  'figure',
  'figcaption',
  'br',
  'hr',
  'form',
  'fieldset',
  'legend',
  'details',
  'summary',
])

/** Attributes that are commonly translatable */
export const DEFAULT_TRANSLATABLE_ATTRIBUTES: Record<string, string[]> = {
  '*': ['title'],
  'input': ['placeholder'],
  'textarea': ['placeholder'],
  'img': ['alt'],
  'area': ['alt'],
  'abbr': ['title'],
  'a': ['title'],
  'button': ['title'],
}

/** Meta tag patterns for translation */
export const META_TRANSLATE_PATTERNS = [
  'keywords',
  'description',
  'sharetitle',
]

/** Meta property patterns for translation */
export const META_PROPERTY_PATTERNS = [
  'og:title',
  'og:description',
  'og:site_name',
]
