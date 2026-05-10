export function lcsLength(a: string, b: string): number {
  const aChars = Array.from(a)
  const bChars = Array.from(b)
  const previous = Array.from<number>({ length: bChars.length + 1 }).fill(0)
  const current = Array.from<number>({ length: bChars.length + 1 }).fill(0)

  for (const aChar of aChars) {
    for (let j = 0; j < bChars.length; j++) {
      current[j + 1] = aChar === bChars[j]
        ? previous[j] + 1
        : Math.max(previous[j + 1] ?? 0, current[j] ?? 0)
    }
    previous.splice(0, previous.length, ...current)
    current.fill(0)
  }

  return previous[bChars.length] ?? 0
}

export function similarity(a: string, b: string): number {
  if (a === b)
    return 1
  if (a.length === 0 || b.length === 0)
    return 0

  return (2 * lcsLength(a, b)) / (Array.from(a).length + Array.from(b).length)
}

export function isFuzzyMatch(a: string, b: string, threshold = 0.8): boolean {
  return similarity(a, b) >= threshold
}
