import { createHash } from 'node:crypto'
import { toPosixPath } from '../paths'

export function generateId(text: string, filePath: string): string {
  return createHash('sha256')
    .update(`${text}:${toPosixPath(filePath)}`)
    .digest('hex')
    .slice(0, 8)
}
