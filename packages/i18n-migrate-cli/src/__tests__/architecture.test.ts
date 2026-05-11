import type { TextSegment } from '../types'
import { describe, expect, it } from 'vitest'
import {
  ApiTranslator,
  createEntry,
  createMapFile,
  createTranslator,
  DEFAULT_CONFIG,
  defineConfig,
  Extractor,
  generateId,
  isFuzzyMatch,
  mapPathToSourcePath,
  mergeMapEntries,
  protectPlaceholders,
  restorePlaceholders,
  shouldTranslate,
  similarity,
  sourcePathToMapPath,
  translateTexts,
} from '../index'
import { LocalTranslator } from '../translator/local'

function segment(text: string, filePath = 'src/views/login.vue'): TextSegment {
  return {
    id: generateId(text, filePath),
    text,
    start: 0,
    end: text.length,
    line: 12,
    column: 8,
    context: 'template',
    nodeType: 'Text',
  }
}

describe('i18n migrate architecture primitives', () => {
  it('keeps map paths reversible by preserving source extensions', () => {
    expect(sourcePathToMapPath('src/views/login.vue')).toBe('.tmigrate/maps/src/views/login.vue.json')
    expect(sourcePathToMapPath('src/utils/constant.ts')).toBe('.tmigrate/maps/src/utils/constant.ts.json')
    expect(mapPathToSourcePath('.tmigrate/maps/src/views/login.vue.json')).toBe('src/views/login.vue')
  })

  it('generates stable ids from source text and file path', () => {
    expect(generateId('请输入用户名', 'src/views/login.vue')).toBe(generateId('请输入用户名', 'src/views/login.vue'))
    expect(generateId('请输入用户名', 'src/views/login.vue')).not.toBe(generateId('请输入用户名', 'src/views/register.vue'))
  })

  it('uses Chinese LCS ratio for fuzzy matching', () => {
    expect(similarity('请输入用户名', '请输入用户名')).toBe(1)
    expect(isFuzzyMatch('请输入用户名', '请输入用户名称')).toBe(true)
    expect(isFuzzyMatch('请输入用户名', '订单已取消')).toBe(false)
  })

  it('protects Vue and JavaScript interpolation placeholders', () => {
    const dollarInterpolation = '$' + '{total}'
    const protectedText = protectPlaceholders(`共 ${dollarInterpolation} 条记录，已读 {{ read }} 条`)

    expect(protectedText.text).toBe('共 __TM_0__ 条记录，已读 __TM_1__ 条')
    expect(restorePlaceholders('Total __TM_0__ records, __TM_1__ read', protectedText.placeholders))
      .toBe(`Total ${dollarInterpolation} records, {{ read }} read`)
  })

  it('recovers placeholders even after the model mutates token punctuation', () => {
    const interpolation = '$' + '{2}'

    expect(restorePlaceholders('您有 TM_ 0 命令待执行', [interpolation]))
      .toBe(`您有 ${interpolation} 命令待执行`)
  })

  it('composes short UI copy from glossary terms before machine translation', async () => {
    const interpolation = '$' + '{2}'
    const results = await translateTexts({
      texts: ['Reject current order', 'Create a new order', `You have ${interpolation} pending orders`],
      config: defineConfig({ sourceLocale: 'en', targetLocale: 'zh' }),
      glossary: {
        'Create': '创建',
        'Reject': '拒绝',
        'current order': '当前订单',
        'new': '新',
        'order': '订单',
        'pending': '待处理',
        'You have': '您有',
      },
      translator: {
        async translate() {
          throw new Error('machine translator should not be called')
        },
      },
    })

    expect(results['Reject current order']).toMatchObject({
      translation: '拒绝当前订单',
      translationSource: 'glossary',
    })
    expect(results['Create a new order']).toMatchObject({
      translation: '创建新订单',
      translationSource: 'glossary',
    })
    expect(results[`You have ${interpolation} pending orders`]).toMatchObject({
      translation: `您有${interpolation}待处理订单`,
      translationSource: 'glossary',
    })
  })

  it('enforces glossary terminology on machine translations', async () => {
    const results = await translateTexts({
      texts: ['Review orders, create shipments, and follow customer updates.'],
      config: defineConfig({ sourceLocale: 'en', targetLocale: 'zh' }),
      glossary: {
        order: '订单',
      },
      translator: {
        async translate(texts) {
          return texts.map(text => ({
            source: text,
            translation: '审查命令,创建货运,并跟踪客户最新情况。',
            translationSource: 'machine' as const,
          }))
        },
      },
    })

    expect(results['Review orders, create shipments, and follow customer updates.']).toMatchObject({
      translation: '审查订单,创建货运,并跟踪客户最新情况。',
      translationSource: 'machine',
    })
  })

  it('applies default filter rules and force-pattern precedence', () => {
    expect(shouldTranslate({ text: '请输入用户名', context: 'template' }, DEFAULT_CONFIG.rules)).toBe(true)
    expect(shouldTranslate({ text: '中', context: 'template' }, DEFAULT_CONFIG.rules)).toBe(false)
    expect(shouldTranslate({ text: '请求失败', context: 'console' }, DEFAULT_CONFIG.rules)).toBe(false)

    const rules = defineConfig({
      rules: [
        { type: 'force-pattern', value: '^提示' },
        { type: 'skip-context', value: 'console' },
      ],
    }).rules
    expect(shouldTranslate({ text: '提示信息', context: 'console' }, rules)).toBe(true)
  })

  it('supports English source locale filtering', () => {
    const config = defineConfig({ sourceLocale: 'en', targetLocale: 'zh' })

    expect(shouldTranslate({ text: 'Order Management', context: 'template', sourceLocale: 'en' }, config.rules)).toBe(true)
    expect(shouldTranslate({ text: '订单管理', context: 'template', sourceLocale: 'en' }, config.rules)).toBe(false)
  })

  it('keeps Vue interpolation expressions in mixed template text segments', () => {
    const extractor = new Extractor(defineConfig({ sourceLocale: 'zh', targetLocale: 'en' }))
    const segments = extractor.extract(
      '<template><p>{{ owner }} 的订单需要人工审核</p></template>',
      'src/views/Order.vue',
    )

    expect(segments.map(segment => segment.text)).toEqual(['{{ owner }} 的订单需要人工审核'])
    expect(segments[0]?.interpolation?.segments).toEqual(['{{ owner }}'])
  })

  it('skips pure Vue interpolation expressions in template text segments', () => {
    const extractor = new Extractor(defineConfig({ sourceLocale: 'en', targetLocale: 'zh' }))
    const segments = extractor.extract(
      '<template><p>{{ owner }}</p></template>',
      'src/views/Order.vue',
    )

    expect(segments).toEqual([])
  })

  it('creates glossary entries as approved and marks missing texts deprecated on merge', () => {
    const first = segment('提交')
    const old = createMapFile({
      提交: createEntry(first, 'Submit', 'glossary'),
      删除: {
        id: generateId('删除', 'src/views/login.vue'),
        translation: 'Delete',
        translationSource: 'manual',
        approved: true,
        skip: false,
      },
    }, new Date('2026-05-10T08:00:00Z'))

    const merged = mergeMapEntries(old, [first], {})

    expect(merged.entries['提交']?.approved).toBe(true)
    expect(merged.entries['提交']?.translationSource).toBe('glossary')
    expect(merged.entries['删除']?.deprecated).toBe(true)
  })

  it('normalizes API translator endpoint responses', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        texts: ['提交', '取消'],
        sourceLocale: 'zh',
        targetLocale: 'en',
      })
      return new Response(JSON.stringify({
        translations: [
          { source: '提交', translation: 'Submit', confidence: 0.9 },
          'Cancel',
        ],
      }), { status: 200 })
    }

    try {
      const translator = new ApiTranslator({ endpoint: 'https://translator.example.test', apiKey: 'token' })
      const results = await translator.translate(['提交', '取消'], { sourceLocale: 'zh', targetLocale: 'en' })

      expect(results).toEqual([
        { source: '提交', translation: 'Submit', translationSource: 'machine', confidence: 0.9 },
        { source: '取消', translation: 'Cancel', translationSource: 'machine' },
      ])
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('falls back to local translation when api mode has no endpoint', () => {
    const translator = createTranslator(defineConfig({
      translator: 'api',
      translatorOptions: { endpoint: '' },
    }))

    expect(translator).toBeInstanceOf(LocalTranslator)
  })
})
