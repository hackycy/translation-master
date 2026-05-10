/**
 * Language detection demo using @translation-master/node
 *
 * Run: pnpm -F playground script:detect
 */
import { detectLanguage, getSupportedLanguages, LANG_TO_FLORES } from '@translation-master/node'

const samples = [
  '你好，世界！',
  'Hello, world!',
  'こんにちは世界',
  '안녕하세요 세계',
  'Bonjour le monde',
  'Hola mundo',
  'Привет мир',
  'مرحبا بالعالم',
  'สวัสดีชาวโลก',
  'Xin chào thế giới',
]

console.log('--- Language detection ---\n')
for (const text of samples) {
  const { lang, confidence } = detectLanguage(text)
  console.log(`  "${text}"`)
  console.log(`    → ${lang} (confidence: ${(confidence * 100).toFixed(1)}%)\n`)
}

console.log('--- Supported languages ---\n')
const langs = getSupportedLanguages()
for (const l of langs) {
  const flores = LANG_TO_FLORES[l.code]
  console.log(`  ${l.code.padEnd(6)} ${l.name.padEnd(25)} ${l.nativeName?.padEnd(12) ?? ''} → ${flores}`)
}
console.log(`\nTotal: ${langs.length} languages`)

console.log('\n--- FLORES code mapping ---\n')
for (const [code, flores] of Object.entries(LANG_TO_FLORES)) {
  console.log(`  ${code.padEnd(6)} → ${flores}`)
}
