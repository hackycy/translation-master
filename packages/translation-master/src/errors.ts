export class UnsupportedLanguagePairError extends Error {
  override name = 'UnsupportedLanguagePairError' as const
  from: string
  to: string

  constructor(from: string, to: string) {
    super(`Unsupported language pair: ${from} → ${to}`)
    this.from = from
    this.to = to
  }
}

export class ModelLoadError extends Error {
  override name = 'ModelLoadError' as const
  modelId: string
  override cause: Error

  constructor(modelId: string, cause: Error) {
    super(`Failed to load model "${modelId}": ${cause.message}`)
    this.modelId = modelId
    this.cause = cause
  }
}

export class TranslationTimeoutError extends Error {
  override name = 'TranslationTimeoutError' as const

  constructor(timeout: number) {
    super(`Translation timed out after ${timeout}ms`)
  }
}

export class DeviceNotAvailableError extends Error {
  override name = 'DeviceNotAvailableError' as const

  constructor(device: string) {
    super(`Device "${device}" is not available in this environment`)
  }
}

export class OutOfMemoryError extends Error {
  override name = 'OutOfMemoryError' as const

  constructor(modelId: string) {
    super(`Insufficient memory to load model "${modelId}"`)
  }
}
