import { beforeEach, describe, expect, it, vi } from 'vitest'

const promptAnswers: unknown[] = []

vi.mock('@clack/prompts', () => ({
  cancel: vi.fn(),
  confirm: vi.fn(async () => promptAnswers.shift()),
  isCancel: () => false,
  multiselect: vi.fn(async () => promptAnswers.shift()),
  select: vi.fn(async () => promptAnswers.shift()),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  })),
  text: vi.fn(async () => promptAnswers.shift()),
}))

describe('init prompts', () => {
  beforeEach(() => {
    promptAnswers.length = 0
  })

  it('collects chrome translator options during interactive init', async () => {
    promptAnswers.push(
      'zh',
      'en',
      ['vue', 'ts'],
      'src',
      'chrome',
      'stable',
      '',
      true,
    )

    const { promptInitConfig } = await import('../prompts')
    const config = await promptInitConfig({})

    expect(config).toMatchObject({
      sourceLocale: 'zh',
      targetLocale: 'en',
      include: ['src/**/*.{vue,ts}'],
      translator: 'chrome',
      translatorOptions: {
        chromeBrowserChannel: 'stable',
        chromeBrowserExecutablePath: '',
        chromeBrowserVisible: true,
      },
    })
  })
})
