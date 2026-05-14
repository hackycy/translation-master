import type { Translator } from '../types'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { adaptSources, applyTranslations, approveTranslations, convertMaps, initGlossary, initProject, restoreBackups, scanProject } from '../index'
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

  it('re-approves legacy approved entries that still need translation or key approval', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'App.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><p>请输入用户名</p></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'App.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean }>
    }
    map.entries['请输入用户名']!.approved = true
    map.entries['请输入用户名']!.translationApproved = false
    map.entries['请输入用户名']!.keyApproved = false
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const approved = await approveTranslations({ cwd })
    expect(approved.files).toMatchObject([
      { sourcePath: 'src/App.vue', approved: 1, alreadyApproved: 0, changed: true },
    ])

    const nextMap = JSON.parse(await readFile(mapPath, 'utf8')) as typeof map
    expect(nextMap.entries['请输入用户名']).toMatchObject({
      approved: true,
      translationApproved: true,
      keyApproved: true,
    })
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
      outputDir: 'src/locales/langs',
      namespace: 'admin',
      format: 'ts',
    })

    expect(result.files).toMatchObject([
      { locale: 'en-US', outputPath: 'src/locales/langs/en-US/admin/components/Table.ts', entries: 2, changed: true },
      { locale: 'zh-CN', outputPath: 'src/locales/langs/zh-CN/admin/components/Table.ts', entries: 2, changed: true },
    ])

    const target = await readFile(path.join(cwd, 'src', 'locales', 'langs', 'en-US', 'admin', 'components', 'Table.ts'), 'utf8')
    const source = await readFile(path.join(cwd, 'src', 'locales', 'langs', 'zh-CN', 'admin', 'components', 'Table.ts'), 'utf8')

    expect(target).toBe(`export default {\n  "enterUsername": "EN:请输入用户名",\n  "submit": "EN:提交"\n}\n`)
    expect(source).toBe(`export default {\n  "enterUsername": "请输入用户名",\n  "submit": "提交"\n}\n`)
  })

  it('fails conversion when approved entries conflict on the same locale key', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Conflict.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>提交</button><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'Conflict.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, key?: string }>
    }
    for (const entry of Object.values(map.entries)) {
      entry.approved = true
      entry.translationApproved = true
      entry.keyApproved = true
      entry.key = 'submit'
    }
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    await expect(convertMaps({ cwd })).rejects.toThrow('Duplicate locale key "submit"')
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
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, translation: string }>
    }
    map.entries['保存设置']!.approved = true
    map.entries['保存设置']!.translationApproved = true
    map.entries['保存设置']!.keyApproved = true
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
      { locale: 'en', outputPath: 'src/locales/langs/en/views/Profile.json', entries: 1, changed: true },
    ])
    expect(await readFile(path.join(cwd, 'src', 'locales', 'langs', 'en', 'views', 'Profile.json'), 'utf8'))
      .toBe(`{\n  "saveSettings": "EN:保存设置"\n}\n`)
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
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, translation: string }>
    }
    map.entries['导出报表']!.approved = true
    map.entries['导出报表']!.translationApproved = true
    map.entries['导出报表']!.keyApproved = true
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
    expect(await readFile(path.join(cwd, 'src', 'locales', 'langs', 'en-US', 'views', 'Reports.json'), 'utf8'))
      .toBe(`{\n  "exportReports": "zh-CN->en-US:导出报表"\n}\n`)
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
    expect(await readFile(path.join(cwd, 'src', 'locales', 'langs', 'en', 'views', 'Alerts.json'), 'utf8'))
      .toBe(`{}\n`)
  })

  it('keeps legacy source-text locale keys behind an explicit convert option', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Legacy.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    await convertMaps({ cwd, includeSourceLocale: false, legacyTextKey: true })

    expect(await readFile(path.join(cwd, 'src', 'locales', 'langs', 'en', 'views', 'Legacy.json'), 'utf8'))
      .toBe(`{\n  "保存设置": "EN:保存设置"\n}\n`)
  })

  it('adapts approved Vue and script source text to i18n key calls', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'components', 'Table.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template>',
      '  <button>提交</button>',
      '  <ATabPane tab="消费记录" />',
      '  <p>最大上传{{ fileMax }}张图片</p>',
      '  <p>{{ user.name }} 有 {{ stats.total }} 条记录</p>',
      '</template>',
      '<script setup lang="ts">',
      'const title = \'账号安全\'',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'components', 'Table.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, key?: string }>
    }
    map.entries['提交']!.key = 'submit'
    map.entries['消费记录']!.key = 'consumptionRecords'
    map.entries['最大上传{{ fileMax }}张图片']!.key = 'maxUploadImages'
    map.entries['{{ user.name }} 有 {{ stats.total }} 条记录']!.key = 'userRecords'
    map.entries['账号安全']!.key = 'accountSecurity'
    for (const entry of Object.values(map.entries)) {
      entry.approved = true
      entry.translationApproved = true
      entry.keyApproved = true
    }
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const preview = await adaptSources({ cwd, path: 'src/components', dryRun: true })
    expect(preview.files[0]?.diff).toContain('+  <button>{{ $t(\'submit\') }}</button>')
    expect(preview.files[0]?.diff).toContain('+  <ATabPane :tab="$t(\'consumptionRecords\')" />')
    expect(preview.files[0]?.diff).toContain('+  <p>{{ $t(\'maxUploadImages\', { fileMax }) }}</p>')
    expect(preview.files[0]?.diff).toContain('+  <p>{{ $t(\'userRecords\', { userName: user.name, statsTotal: stats.total }) }}</p>')
    expect(preview.files[0]?.diff).toContain('+import { useI18n } from \'vue-i18n\'')
    expect(preview.files[0]?.diff).toContain('+const { t } = useI18n()')
    expect(preview.files[0]?.diff).toContain('+const title = t(\'accountSecurity\')')

    const adapted = await adaptSources({ cwd, path: 'src/components' })
    expect(adapted.files).toMatchObject([{ changed: true, applied: 5 }])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template>',
      '  <button>{{ $t(\'submit\') }}</button>',
      '  <ATabPane :tab="$t(\'consumptionRecords\')" />',
      '  <p>{{ $t(\'maxUploadImages\', { fileMax }) }}</p>',
      '  <p>{{ $t(\'userRecords\', { userName: user.name, statsTotal: stats.total }) }}</p>',
      '</template>',
      '<script setup lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const title = t(\'accountSecurity\')',
      '</script>',
      '',
    ].join('\n'))
  })

  it('does not inject Vue script setup runtime when only template text is adapted', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'TemplateOnly.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template><h1>账号安全</h1></template>',
      '<script setup lang="ts">',
      'import { computed } from \'vue\'',
      'const count = computed(() => 1)',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template><h1>{{ $t(\'accountSecurity\') }}</h1></template>',
      '<script setup lang="ts">',
      'import { computed } from \'vue\'',
      'const count = computed(() => 1)',
      '</script>',
      '',
    ].join('\n'))
  })

  it('inserts Vue script setup runtime after existing imports and adapts simple template literals', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'ScriptSetupImports.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script setup lang="ts">',
      'import { computed } from \'vue\'',
      'const title = `账号安全`',
      'const label = computed(() => title)',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script setup lang="ts">',
      'import { computed } from \'vue\'',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const title = t(\'accountSecurity\')',
      'const label = computed(() => title)',
      '</script>',
      '',
    ].join('\n'))
  })

  it('adapts one pending file by default and records completed maps', async () => {
    const cwd = await createTempProject()
    const appPath = path.join(cwd, 'src', 'App.vue')
    const settingsPath = path.join(cwd, 'src', 'Settings.vue')
    await mkdir(path.dirname(appPath), { recursive: true })
    await writeFile(appPath, '<template><button>提交</button></template>\n', 'utf8')
    await writeFile(settingsPath, '<template><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const first = await adaptSources({ cwd })
    expect(first.files).toMatchObject([{ sourcePath: 'src/App.vue', changed: true, applied: 1 }])
    expect(await readFile(appPath, 'utf8')).toContain('$t(\'submit\')')
    expect(await readFile(settingsPath, 'utf8')).toContain('保存设置')

    const appMap = JSON.parse(await readFile(path.join(cwd, '.tmigrate', 'maps', 'src', 'App.vue.json'), 'utf8')) as {
      adapt?: { adaptedAt?: string, entryRefs?: string[], applied?: number, changed?: boolean }
    }
    expect(appMap.adapt?.adaptedAt).toBeTruthy()
    expect(appMap.adapt?.entryRefs).toHaveLength(1)
    expect(appMap.adapt).toMatchObject({ applied: 1, changed: true })

    const statsAfterFirst = await collectMapStats({ cwd })
    expect(statsAfterFirst.current.adaptReadyMapFiles).toBe(2)
    expect(statsAfterFirst.current.adaptedMapFiles).toBe(1)
    expect(statsAfterFirst.current.pendingAdaptMapFiles).toBe(1)

    const second = await adaptSources({ cwd })
    expect(second.files).toMatchObject([{ sourcePath: 'src/Settings.vue', changed: true, applied: 1 }])
    expect(await readFile(settingsPath, 'utf8')).toContain('$t(\'saveSettings\')')

    const third = await adaptSources({ cwd })
    expect(third.files).toHaveLength(0)
  })

  it('adapts every ready file when requested with all', async () => {
    const cwd = await createTempProject()
    const appPath = path.join(cwd, 'src', 'App.vue')
    const settingsPath = path.join(cwd, 'src', 'Settings.vue')
    await mkdir(path.dirname(appPath), { recursive: true })
    await writeFile(appPath, '<template><button>提交</button></template>\n', 'utf8')
    await writeFile(settingsPath, '<template><button>保存设置</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd, all: true })
    expect(result.files).toMatchObject([
      { sourcePath: 'src/App.vue', changed: true, applied: 1 },
      { sourcePath: 'src/Settings.vue', changed: true, applied: 1 },
    ])
    expect(await readFile(appPath, 'utf8')).toContain('$t(\'submit\')')
    expect(await readFile(settingsPath, 'utf8')).toContain('$t(\'saveSettings\')')
  })

  it('ignores legacy runtime injection config when adapting script setup', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Account.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template><h1>账号安全</h1></template>',
      '<script setup lang="ts">',
      'const title = \'账号安全\'',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = { import: { script: { enabled: true } } }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })
    await adaptSources({ cwd })

    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template><h1>{{ $t(\'accountSecurity\') }}</h1></template>',
      '<script setup lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const title = t(\'accountSecurity\')',
      '</script>',
      '',
    ].join('\n'))
  })

  it('supports custom script callee when injecting Vue i18n runtime', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'CustomRuntime.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template><h1>账号安全</h1></template>',
      '<script setup lang="ts">',
      'const title = \'账号安全\'',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = {
      callee: { script: 'translate' },
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })
    await adaptSources({ cwd })

    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template><h1>{{ $t(\'accountSecurity\') }}</h1></template>',
      '<script setup lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t: translate } = useI18n()',
      'const title = translate(\'accountSecurity\')',
      '</script>',
      '',
    ].join('\n'))
  })

  it('supports configured Vue runtime import source, named export, and local alias', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'CustomVueRuntime.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script setup lang="ts">',
      'const title = \'账号安全\'',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = {
      runtime: {
        vue: {
          import: {
            source: '@/i18n/runtime',
            named: 'useTranslation',
            local: 'useTmigrateI18n',
          },
        },
      },
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })
    await adaptSources({ cwd })

    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script setup lang="ts">',
      'import { useTranslation as useTmigrateI18n } from \'@/i18n/runtime\'',
      'const { t } = useTmigrateI18n()',
      'const title = t(\'accountSecurity\')',
      '</script>',
      '',
    ].join('\n'))
  })

  it('skips top-level normal Vue script strings that have no runtime context', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Options.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template><h1>账号安全</h1></template>',
      '<script lang="ts">',
      'const title = \'账号安全\'',
      'export default { name: \'OptionsPage\' }',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toMatchObject([{ text: '账号安全', reason: 'unsupported-context' }])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template><h1>{{ $t(\'accountSecurity\') }}</h1></template>',
      '<script lang="ts">',
      'const title = \'账号安全\'',
      'export default { name: \'OptionsPage\' }',
      '</script>',
      '',
    ].join('\n'))
  })

  it('adapts Vue Options API method strings to this.$t calls', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'OptionsMethod.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script lang="ts">',
      'export default {',
      '  methods: {',
      '    pageTitle() {',
      '      return \'账号安全\'',
      '    },',
      '  },',
      '}',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script lang="ts">',
      'export default {',
      '  methods: {',
      '    pageTitle() {',
      '      return this.$t(\'accountSecurity\')',
      '    },',
      '  },',
      '}',
      '</script>',
      '',
    ].join('\n'))
  })

  it('skips Vue Options API arrow function strings because this.$t is unavailable', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'OptionsArrow.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script lang="ts">',
      'export default {',
      '  data: () => ({',
      '    title: \'账号安全\',',
      '  }),',
      '}',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toMatchObject([{ text: '账号安全', reason: 'unsupported-context' }])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script lang="ts">',
      'export default {',
      '  data: () => ({',
      '    title: \'账号安全\',',
      '  }),',
      '}',
      '</script>',
      '',
    ].join('\n'))
  })

  it('skips non-component object method strings in normal Vue scripts', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'HelperObject.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script lang="ts">',
      'const helper = {',
      '  pageTitle() {',
      '    return \'账号安全\'',
      '  },',
      '}',
      'export default { name: \'HelperObject\' }',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toMatchObject([{ text: '账号安全', reason: 'unsupported-context' }])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script lang="ts">',
      'const helper = {',
      '  pageTitle() {',
      '    return \'账号安全\'',
      '  },',
      '}',
      'export default { name: \'HelperObject\' }',
      '</script>',
      '',
    ].join('\n'))
  })

  it('injects Vue i18n runtime inside normal script setup functions', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Composition.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script lang="ts">',
      'export default {',
      '  setup() {',
      '    const title = \'账号安全\'',
      '    return { title }',
      '  },',
      '}',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script lang="ts">',
      'import { useI18n } from \'vue-i18n\'',
      'export default {',
      '  setup() {',
      '    const { t } = useI18n()',
      '    const title = t(\'accountSecurity\')',
      '    return { title }',
      '  },',
      '}',
      '</script>',
      '',
    ].join('\n'))
  })

  it('injects configured runtime imports for plain TypeScript modules', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'messages.ts')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, 'export const title = \'账号安全\'\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = {
      runtime: {
        script: {
          import: {
            source: '@/i18n',
            named: 't',
          },
        },
      },
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      'import { t } from \'@/i18n\'',
      'export const title = t(\'accountSecurity\')',
      '',
    ].join('\n'))
  })

  it('supports legacy script runtime import config fields', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'legacy-runtime.ts')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, 'export const title = \'账号安全\'\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = {
      runtime: {
        script: {
          importSource: '@/i18n',
          imported: 'translate',
          local: 't',
        },
      },
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      'import { translate as t } from \'@/i18n\'',
      'export const title = t(\'accountSecurity\')',
      '',
    ].join('\n'))
  })

  it('skips plain TypeScript modules when no runtime is configured', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'messages.ts')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, 'export const title = \'账号安全\'\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })

    const result = await adaptSources({ cwd })

    expect(result.skipped).toMatchObject([{ text: '账号安全', reason: 'unsupported-context' }])
    expect(await readFile(sourcePath, 'utf8')).toBe('export const title = \'账号安全\'\n')
  })

  it('adapts Vue template directive expression strings', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'DynamicTemplate.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<template>',
      '  <button :title="\'提交\'" v-if="status === \'失败\'" @click="message = \'保存成功\'">保存</button>',
      '</template>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'DynamicTemplate.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, key?: string }>
    }
    map.entries['提交']!.key = 'submit'
    map.entries['失败']!.key = 'failed'
    map.entries['保存成功']!.key = 'saveSucceeded'
    map.entries['保存']!.key = 'save'
    for (const entry of Object.values(map.entries)) {
      entry.approved = true
      entry.translationApproved = true
      entry.keyApproved = true
    }
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<template>',
      '  <button :title="$t(\'submit\')" v-if="status === $t(\'failed\')" @click="message = $t(\'saveSucceeded\')">{{ $t(\'save\') }}</button>',
      '</template>',
      '',
    ].join('\n'))
  })

  it('adapts Vue TSX script setup JSX text and attributes', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Render.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      '<script setup lang="tsx">',
      'const renderButton = () => <ElButton title="提交">{status === \'失败\' ? \'重试\' : \'继续\'}</ElButton>',
      '</script>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'views', 'Render.vue.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, key?: string }>
    }
    map.entries['提交']!.key = 'submit'
    map.entries['失败']!.key = 'failed'
    map.entries['重试']!.key = 'retry'
    map.entries['继续']!.key = 'continue'
    for (const entry of Object.values(map.entries)) {
      entry.approved = true
      entry.translationApproved = true
      entry.keyApproved = true
    }
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      '<script setup lang="tsx">',
      'import { useI18n } from \'vue-i18n\'',
      'const { t } = useI18n()',
      'const renderButton = () => <ElButton title={t(\'submit\')}>{status === t(\'failed\') ? t(\'retry\') : t(\'continue\')}</ElButton>',
      '</script>',
      '',
    ].join('\n'))
  })

  it('adapts plain Vue TSX modules when runtime binding already exists', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'render.tsx')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, [
      'import { t } from \'@/i18n\'',
      'export const renderButton = () => <ElButton title="提交">保存</ElButton>',
      '',
    ].join('\n'), 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })

    const mapPath = path.join(cwd, '.tmigrate', 'maps', 'src', 'render.tsx.json')
    const map = JSON.parse(await readFile(mapPath, 'utf8')) as {
      entries: Record<string, { approved: boolean, translationApproved?: boolean, keyApproved?: boolean, key?: string }>
    }
    map.entries['提交']!.key = 'submit'
    map.entries['保存']!.key = 'save'
    for (const entry of Object.values(map.entries)) {
      entry.approved = true
      entry.translationApproved = true
      entry.keyApproved = true
    }
    await writeFile(mapPath, JSON.stringify(map, null, 2), 'utf8')

    const result = await adaptSources({ cwd })

    expect(result.skipped).toEqual([])
    expect(await readFile(sourcePath, 'utf8')).toBe([
      'import { t } from \'@/i18n\'',
      'export const renderButton = () => <ElButton title={t(\'submit\')}>{t(\'save\')}</ElButton>',
      '',
    ].join('\n'))
  })

  it('supports full key references when adapting source code', async () => {
    const cwd = await createTempProject()
    const sourcePath = path.join(cwd, 'src', 'views', 'Login.vue')
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, '<template><button>提交</button></template>\n', 'utf8')

    await initProject({ cwd, overwrite: false, from: 'zh', to: 'en' })
    const configPath = path.join(cwd, '.tmigrate', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { adapt?: Record<string, unknown> }
    config.adapt = { keyReference: { mode: 'full', separator: '.' } }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8')

    await scanProject({ cwd, path: 'src', translator: new EchoTranslator() })
    await approveTranslations({ cwd })
    await adaptSources({ cwd })

    expect(await readFile(sourcePath, 'utf8')).toBe('<template><button>{{ $t(\'views.Login.submit\') }}</button></template>\n')
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
