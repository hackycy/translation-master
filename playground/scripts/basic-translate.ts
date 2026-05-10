import process from 'node:process'

/**
 * Basic translation demo using @translation-master/node
 *
 * Run: pnpm -F playground script
 */
import { Translator } from '@translation-master/node'

const translator = new Translator({
  device: 'cpu',
  debug: true,
})

// Listen to model load progress
translator.events.on('modelLoad', (e) => {
  if (e.state === 'progress') {
    process.stdout.write(`\rLoading model ${e.modelId}: ${e.progress.toFixed(1)}%`)
  }
  else if (e.state === 'ready') {
    console.log(`\nModel ${e.modelId} ready!`)
  }
})

// Chinese → English
console.log('--- Chinese to English ---')
const r1 = await translator.translate('你好，世界！这是一个翻译测试。', { to: 'en' })
console.log(`  Result:  ${r1.text}`)
console.log(`  From:    ${r1.from} → ${r1.to}`)
console.log(`  Model:   ${r1.model}`)
console.log(`  Time:    ${r1.duration}ms`)

// English → Chinese
console.log('\n--- English to Chinese ---')
const r2 = await translator.translate('The weather is beautiful today.', { to: 'zh' })
console.log(`  Result:  ${r2.text}`)
console.log(`  From:    ${r2.from} → ${r2.to}`)
console.log(`  Model:   ${r2.model}`)
console.log(`  Time:    ${r2.duration}ms`)

// English → Japanese
console.log('\n--- English to Japanese ---')
const r3 = await translator.translate('Hello, how are you?', { to: 'ja' })
console.log(`  Result:  ${r3.text}`)
console.log(`  From:    ${r3.from} → ${r3.to}`)
console.log(`  Model:   ${r3.model}`)
console.log(`  Time:    ${r3.duration}ms`)

// Cached result (should be instant)
console.log('\n--- Cached result ---')
const r4 = await translator.translate('你好，世界！这是一个翻译测试。', { to: 'en' })
console.log(`  Result:  ${r4.text}`)
console.log(`  Cached:  ${r4.cached}`)
console.log(`  Time:    ${r4.duration}ms`)

// Pool stats
console.log('\n--- Pool stats ---')
console.log(translator.stats())

await translator.dispose()
console.log('\nDone!')
