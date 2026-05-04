/** Thrown when a DOM translation is cancelled via AbortController */
export class DOMTranslationCancelledError extends Error {
  constructor() {
    super('DOM translation was cancelled')
    this.name = 'DOMTranslationCancelledError'
  }
}

/** Thrown when translatePage is called while a translation is already in progress */
export class DOMTranslationInProgressError extends Error {
  constructor() {
    super('A DOM translation is already in progress. Cancel the current one first or wait for it to finish.')
    this.name = 'DOMTranslationInProgressError'
  }
}
