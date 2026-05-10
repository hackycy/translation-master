export interface ProtectedText {
  text: string
  placeholders: string[]
}

const INTERPOLATION_RE = /(\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\})/g

export function protectPlaceholders(text: string): ProtectedText {
  const placeholders: string[] = []
  const protectedText = text.replace(INTERPOLATION_RE, (match) => {
    const token = `__TM_${placeholders.length}__`
    placeholders.push(match)
    return token
  })

  return {
    text: protectedText,
    placeholders,
  }
}

export function restorePlaceholders(text: string, placeholders: string[]): string {
  let restored = text.replace(/__TM_(\d+)__/g, (match, index: string) => {
    return placeholders[Number(index)] ?? match
  })

  for (let index = 0; index < placeholders.length; index++) {
    const placeholder = placeholders[index]
    const pattern = buildPlaceholderPattern(index)
    restored = restored.replace(pattern, placeholder)
  }

  return restored
}

function buildPlaceholderPattern(index: number): RegExp {
  const escapedIndex = String(index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:__+)?T[\\W_]*M[\\W_]*${escapedIndex}(?:__+)?`, 'giu')
}
