import type { Translator } from '../types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { applyTranslations, approveTranslations, convertMaps, initGlossary, initProject, restoreBackups, scanProject } from '../index'
import { collectMapStats, formatMapStatsReport } from '../stats'

const tempDirs: string[] = []
const LOCAL_GLOSSARY_PRESET_INDEX = fileURLToPath(new URL('../glossary-presets/index.json', import.meta.url))

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

class LocaleAwareTranslator implements Translator {
  seen: Array<{ sourceLocale: string, targetLocale: string }> = []

  async translate(texts: string[], options: Parameters<Translator['translate']>[1]) {
    this.seen.push({
      sourceLocale: options.sourceLocale,
      targetLocale: options.targetLocale,
    })
    return texts.map(text => ({
      source: text,
      translation: `${options.sourceLocale}->${options.targetLocale}:${text}`,
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

  it('bulk approves safe map entries and supports scoped overrides', async () => {
    const cwd = await createTempProject()
    const appPath = path.join(cwd, 'src', 'App.vue')
    const settingsPath = path.join(cwd, 'src', 'Settings.vue')
    await mkdir(path.dirname(appPath), { recursive: true })
    await writeFile(appPath, '<template><p>请输入用户名</p><p>跳过此项</p><p>空译文</p></template>\n', 'utf8')
    await writeFile(settingsPath, '<template><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const appMapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'App.vue.json')
    const settingsMapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'Settings.vue.json')
    const appMap = JSON.parse(await readFile(appMapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translation: string, skip?: boolean, deprecated?: boolean }>
    }
    appMap.entries['跳过此项']!.skip = true
    appMap.entries['空译文']!.translation = ''
    appMap.entries['旧文案'] = {
      approved: false,
      translation: 'Old copy',
      skip: false,
      deprecated: true,
    }
    await writeFile(appMapPath, JSON.stringify(appMap, null, 2), 'utf8')

    const preview = await approveTranslations({ cwd, path: 'src/App.vue', dryRun: true })
    expect(preview.files).toMatchObject([
      { sourcePath: 'src/App.vue', approved: 1, skipped: 3, changed: true },
    ])
    expect(JSON.parse(await readFile(appMapPath, 'utf8')).entries['请输入用户名'].approved).toBe(false)

    const approved = await approveTranslations({ cwd, path: 'src/App.vue' })
    expect(approved.files).toMatchObject([
      { sourcePath: 'src/App.vue', approved: 1, skipped: 3, changed: true },
    ])

    const nextAppMap = JSON.parse(await readFile(appMapPath, 'utf8')) as typeof appMap
    expect(nextAppMap.entries['请输入用户名']?.approved).toBe(true)
    expect(nextAppMap.entries['跳过此项']?.approved).toBe(false)
    expect(nextAppMap.entries['空译文']?.approved).toBe(false)
    expect(nextAppMap.entries['旧文案']?.approved).toBe(false)

    const settingsMap = JSON.parse(await readFile(settingsMapPath, 'utf8')) as typeof appMap
    expect(settingsMap.entries['保存设置']?.approved).toBe(false)

    await approveTranslations({
      cwd,
      path: 'src/App.vue',
      includeSkipped: true,
      includeDeprecated: true,
      allowEmpty: true,
    })
    const overriddenAppMap = JSON.parse(await readFile(appMapPath, 'utf8')) as typeof appMap
    expect(overriddenAppMap.entries['跳过此项']?.approved).toBe(true)
    expect(overriddenAppMap.entries['空译文']?.approved).toBe(true)
    expect(overriddenAppMap.entries['旧文案']?.approved).toBe(true)
  })

  it('converts approved maps into source and target locale packages', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'components', 'Table.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>提交</button><p>请输入用户名</p></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh-CN', to: 'en-US' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await convertMaps({
      cwd,
      path: 'src/components',
      outputDir: 'locales/langs',
      namespace: 'admin',
      format: 'ts',
    })

    expect(result.files).toMatchObject([
      { locale: 'en-US', outputPath: 'locales/langs/en-US/admin/components/Table.ts', entries: 2, changed: true },
      { locale: 'zh-CN', outputPath: 'locales/langs/zh-CN/admin/components/Table.ts', entries: 2, changed: true },
    ])

    const target = await readFile(path.join(cwd, 'locales', 'langs', 'en-US', 'admin', 'components', 'Table.ts'), 'utf8')
    const source = await readFile(path.join(cwd, 'locales', 'langs', 'zh-CN', 'admin', 'components', 'Table.ts'), 'utf8')

    expect(target).toBe(`export default {\n  "提交": "EN:提交",\n  "请输入用户名": "EN:请输入用户名"\n}\n`)
    expect(source).toBe(`export default {\n  "提交": "提交",\n  "请输入用户名": "请输入用户名"\n}\n`)
  })

  it('supports target-only json conversion and translates approved empty entries on demand', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Profile.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'Profile.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translation: string }>
    }
    map.entries['保存设置']!.approved = true
    map.entries['保存设置']!.translation = ''
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const result = await convertMaps({
      cwd,
      format: 'json',
      includeSourceLocale: false,
      translateMissing: true,
      translator: new EchoTranslator(),
    })

    expect(result.files).toMatchObject([
      { locale: 'en', outputPath: 'locales/langs/en/views/Profile.json', entries: 1, changed: true },
    ])
    expect(await readFile(path.join(cwd, 'locales', 'langs', 'en', 'views', 'Profile.json'), 'utf8'))
      .toBe(`{\n  "保存设置": "EN:保存设置"\n}\n`)
  })

  it('uses convert locale overrides when translating missing entries', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Reports.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>导出报表</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'Reports.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translation: string }>
    }
    map.entries['导出报表']!.approved = true
    map.entries['导出报表']!.translation = ''
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const translator = new LocaleAwareTranslator()
    await convertMaps({
      cwd,
      includeSourceLocale: false,
      translateMissing: true,
      sourceLocale: 'zh-CN',
      targetLocale: 'en-US',
      translator,
    })

    expect(translator.seen).toEqual([{ sourceLocale: 'zh-CN', targetLocale: 'en-US' }])
    expect(await readFile(path.join(cwd, 'locales', 'langs', 'en-US', 'views', 'Reports.json'), 'utf8'))
      .toBe(`{\n  "导出报表": "zh-CN->en-US:导出报表"\n}\n`)
  })

  it('allows convert options to disable configured missing translation', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Alerts.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>异常提醒</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { convert?: Record<string, unknown> }
    config.convert = { ...config.convert, translateMissing: true }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'Alerts.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translation: string }>
    }
    map.entries['异常提醒']!.approved = true
    map.entries['异常提醒']!.translation = ''
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const translator = new LocaleAwareTranslator()
    await convertMaps({
      cwd,
      includeSourceLocale: false,
      translateMissing: false,
      translator,
    })

    expect(translator.seen).toEqual([])
    expect(await readFile(path.join(cwd, 'locales', 'langs', 'en', 'views', 'Alerts.json'), 'utf8'))
      .toBe(`{}\n`)
  })

  it('seeds glossary presets without clobbering existing manual terms by default', async () => {
    const cwd = await createTempProject()
    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const glossaryPath = path.join(cwd, '.tmigrate', 'glossary.json')
    await writeFile(glossaryPath, JSON.stringify({ 提交: 'Send', 自定义: 'Custom' }, null, 2), 'utf8')

    const preview = await initGlossary({ cwd, preset: 'business', dryRun: true, presetIndex: LOCAL_GLOSSARY_PRESET_INDEX })
    expect(preview.entries.订单).toBe('Order')
    expect(JSON.parse(await readFile(glossaryPath, 'utf8')).订单).toBeUndefined()

    const seeded = await initGlossary({ cwd, preset: 'all', presetIndex: LOCAL_GLOSSARY_PRESET_INDEX })
    expect(seeded.added).toBeGreaterThan(0)
    expect(seeded.skipped).toBe(1)
    expect(seeded.entries.提交).toBe('Send')
    expect(seeded.entries.自定义).toBe('Custom')

    const saved = JSON.parse(await readFile(glossaryPath, 'utf8')) as Record<string, string>
    expect(saved.订单).toBe('Order')
    expect(saved.提交).toBe('Send')

    const overwritten = await initGlossary({ cwd, preset: 'ui', overwrite: true, presetIndex: LOCAL_GLOSSARY_PRESET_INDEX })
    expect(overwritten.updated).toBe(1)
    expect(overwritten.entries.提交).toBe('Submit')
  })

  it('supports English to Chinese glossary presets from project config', async () => {
    const cwd = await createTempProject()
    await initProject({ cwd, overwrite: false, from: 'en', to: 'zh' })

    const seeded = await initGlossary({ cwd, preset: 'ui', presetIndex: LOCAL_GLOSSARY_PRESET_INDEX })
    expect(seeded.sourceLocale).toBe('en')
    expect(seeded.targetLocale).toBe('zh')
    expect(seeded.entries.Submit).toBe('提交')
    expect(seeded.entries.Search).toBe('搜索')
  })

  it('initializes chrome translator config in non-interactive mode', async () => {
    const cwd = await createTempProject()
    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en', translator: 'chrome' })

    const config = JSON.parse(await readFile(path.join(cwd, '.tmigrate', 'config.json'), 'utf8')) as {
      translator: string
      translatorOptions: Record<string, unknown>
    }

    expect(config.translator).toBe('chrome')
    expect(config.translatorOptions).toMatchObject({
      chromeBrowserChannel: 'stable',
      chromeBrowserExecutablePath: '',
      chromeBrowserVisible: true,
    })
  })

  it('summarizes map progress and flags orphaned files', async () => {
    const cwd = await createTempProject()
    const appPath = path.join(cwd, 'src', 'App.vue')
    const orphanPath = path.join(cwd, 'src', 'Legacy.vue')
    await mkdir(path.dirname(appPath), { recursive: true })
    await writeFile(appPath, '<template><button>提交</button><p>请输入用户名</p><p>跳过此项</p><p>旧文案</p></template>\n', 'utf8')
    await writeFile(orphanPath, '<template><p>遗留文案</p></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await writeFile(path.join(cwd, '.tmigrate', 'glossary.json'), JSON.stringify({ 提交: 'Submit' }, null, 2), 'utf8')
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    await import('node:fs/promises').then(fs => fs.unlink(orphanPath))

    const appMapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'App.vue.json')
    const appMap = JSON.parse(await readFile(appMapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translation: string, skip?: boolean, deprecated?: boolean }>
    }
    appMap.entries['跳过此项']!.skip = true
    appMap.entries['旧文案']!.deprecated = true
    await writeFile(appMapPath, JSON.stringify(appMap, null, 2), 'utf8')

    const report = await collectMapStats({ cwd })
    const output = formatMapStatsReport(report)

    expect(report.discoveredMapFiles).toBe(2)
    expect(report.validMapFiles).toBe(2)
    expect(report.current.mapFiles).toBe(1)
    expect(report.orphaned.mapFiles).toBe(1)
    expect(report.current.readyToApplyEntries).toBe(1)
    expect(report.current.pendingReviewEntries).toBe(1)
    expect(report.current.skippedEntries).toBe(1)
    expect(report.current.deprecatedEntries).toBe(1)
    expect(report.orphaned.pendingReviewEntries).toBe(1)
    expect(output).toContain('tmigrate stats dashboard')
    expect(output).toContain('总览')
    expect(output).toContain('迁移进度')
    expect(output).toContain('工作队列')
    expect(output).toContain('重点文件 Top 5')
    expect(output).toContain('孤儿 map Top 5')
    expect(output).toContain('待校对')
    expect(output).not.toContain('文件明细')
  })
})

async function createTempProject(): Promise<string> {
  const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(path.join(os.tmpdir(), 'tmigrate-')))
  tempDirs.push(dir)
  return dir
}
