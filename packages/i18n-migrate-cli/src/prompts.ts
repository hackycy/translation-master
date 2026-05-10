import type { MigrateConfigInput } from './config'
import process from 'node:process'
import { cancel, confirm, isCancel, multiselect, select, spinner, text } from '@clack/prompts'

export async function promptInitConfig(defaults: MigrateConfigInput): Promise<MigrateConfigInput> {
  const sourceLocale = await select({
    message: 'Source locale',
    initialValue: defaults.sourceLocale ?? 'zh',
    options: [
      { value: 'zh', label: 'Chinese (zh)' },
      { value: 'en', label: 'English (en)' },
      { value: 'ja', label: 'Japanese (ja)' },
    ],
  })
  assertPromptValue(sourceLocale)

  const targetLocale = await select({
    message: 'Target locale',
    initialValue: defaults.targetLocale ?? 'en',
    options: [
      { value: 'en', label: 'English (en)' },
      { value: 'zh', label: 'Chinese (zh)' },
      { value: 'ja', label: 'Japanese (ja)' },
    ],
  })
  assertPromptValue(targetLocale)

  const fileTypes = await multiselect({
    message: 'File types to scan',
    initialValues: ['vue', 'ts', 'tsx', 'js', 'jsx', 'json', 'html'],
    options: [
      { value: 'vue', label: 'Vue SFC' },
      { value: 'ts', label: 'TypeScript' },
      { value: 'tsx', label: 'TSX' },
      { value: 'js', label: 'JavaScript' },
      { value: 'jsx', label: 'JSX' },
      { value: 'json', label: 'JSON' },
      { value: 'html', label: 'HTML' },
      { value: 'css', label: 'CSS / SCSS / Less' },
      { value: 'md', label: 'Markdown' },
      { value: 'yaml', label: 'YAML' },
    ],
  })
  assertPromptValue(fileTypes)

  const sourceRoot = await text({
    message: 'Source root',
    initialValue: 'src',
    placeholder: 'src',
  })
  assertPromptValue(sourceRoot)

  return {
    sourceLocale,
    targetLocale,
    include: [`${sourceRoot}/**/*.{${expandFileTypes(fileTypes).join(',')}}`],
  }
}

export async function confirmOverwriteTmigrate(): Promise<boolean> {
  const answer = await confirm({
    message: '.tmigrate already exists. Overwrite existing config and glossary?',
    initialValue: false,
  })
  assertPromptValue(answer)
  return answer
}

export function createSpinner() {
  return spinner()
}

function assertPromptValue<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel('Cancelled')
    process.exit(0)
  }
}

function expandFileTypes(types: string[]): string[] {
  return types.flatMap((type) => {
    if (type === 'css')
      return ['css', 'scss', 'less']
    if (type === 'yaml')
      return ['yaml', 'yml']
    return [type]
  })
}
