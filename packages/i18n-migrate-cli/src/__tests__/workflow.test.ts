import type { Translator } from '../types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyTranslations, initProject, restoreBackups, scanProject } from '../index'

const tempDirs: string[] = []

class EchoTranslator implements Translator {
  async translate(texts: string[]) {
    return texts.map(text => ({
      source: text,
      translation: `EN:${text}`,
      translationSource: 'machine' as const,
    }))
  }
}

class ZhEchoTranslator implements Translator {
  async translate(texts: string[]) {
    return texts.map(text => ({
      source: text,
      translation: `中文:${text}`,
      translationSource: 'machine' as const,
    }))
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async dir => import('node:fs/promises').then(fs => fs.rm(dir, { recursive: true, force: true }))))
})

describe('i18n migrate workflow', () => {
  it('initializes, scans maps, applies approved translations, and restores backups', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'App.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>提交</button><input placeholder="请输入用户名"></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await writeFile(path.join(cwd, '.tmigrate', 'glossary.json'), JSON.stringify({ 提交: 'Submit' }, null, 2), 'utf8')

    const scan = await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    expect(scan.scannedFiles).toBe(1)
    expect(scan.extractedTexts).toBe(2)

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'App.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as { entries: Record<string, { approved: boolean, translation: string }> }
    expect(map.entries['提交']).toMatchObject({ approved: true, translation: 'Submit' })
    expect(map.entries['请输入用户名']).toMatchObject({ approved: false, translation: 'EN:请输入用户名' })

    map.entries['请输入用户名']!.approved = true
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const preview = await applyTranslations({ cwd, dryRun: true })
    expect(preview.files[0]?.diff).toContain('+<template><button>Submit</button><input placeholder="EN:请输入用户名"></template>')

    const applied = await applyTranslations({ cwd })
    expect(applied.files[0]).toMatchObject({ changed: true, applied: 2 })
    expect(await readFile(sourcePath, 'utf8')).toContain('Submit')

    const backups = await restoreBackups({ cwd, list: true })
    expect(backups.available).toHaveLength(1)

    const restored = await restoreBackups({ cwd })
    expect(restored.restored).toEqual(['src/App.vue'])
    expect(await readFile(sourcePath, 'utf8')).toContain('提交')
  })

  it('scans and applies English to Chinese migrations', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'Dashboard.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><h1>Order Management</h1><button title="Create order">Search</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'en', to: 'zh' })
    await writeFile(path.join(cwd, '.tmigrate', 'glossary.json'), JSON.stringify({ Search: '搜索' }, null, 2), 'utf8')

    const scan = await scanProject({ cwd, path: 'src', translator: new ZhEchoTranslator() })
    expect(scan.scannedFiles).toBe(1)
    expect(scan.extractedTexts).toBe(3)

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'Dashboard.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as { entries: Record<string, { approved: boolean, translation: string }> }
    expect(map.entries.Search).toMatchObject({ approved: true, translation: '搜索' })
    expect(map.entries['Order Management']).toMatchObject({ approved: false, translation: '中文:Order Management' })

    map.entries['Order Management']!.approved = true
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const preview = await applyTranslations({ cwd, dryRun: true })
    expect(preview.files[0]?.diff).toContain('+<template><h1>中文:Order Management</h1><button title="Create order">搜索</button></template>')
  })
})

async function createTempProject(): Promise<string> {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'tmigrate-')))
  tempDirs.push(dir)
  return dir
}
