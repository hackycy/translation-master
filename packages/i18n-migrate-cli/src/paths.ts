import path from 'node:path'

const JSON_SUFFIX = '.json'

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export function sourcePathToMapPath(sourcePath: string): string {
  return toPosixPath(path.join('.tmigrate', 'maps', sourcePath)) + JSON_SUFFIX
}

export function mapPathToSourcePath(mapPath: string): string {
  const normalized = toPosixPath(mapPath)
  const prefix = '.tmigrate/maps/'

  if (!normalized.startsWith(prefix) || !normalized.endsWith(JSON_SUFFIX))
    throw new Error(`Invalid map path: ${mapPath}`)

  return normalized.slice(prefix.length, -JSON_SUFFIX.length)
}
