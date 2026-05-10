import process from 'node:process'

/**
 * Batch translation demo using @translation-master/node
 *
 * Run: pnpm -F playground script:batch
 */
import { Translator } from '@translation-master/node'

const translator = new Translator({ device: 'cpu' })

translator.events.on('modelLoad', (e) => {
  if (e.state === 'progress') {
    process.stdout.write(`\rLoading model ${e.modelId}: ${e.progress.toFixed(1)}%`)
  }
  else if (e.state === 'ready') {
    console.log(`\nModel ${e.modelId} ready!`)
  }
})

const texts = [
  '今天天气真好',
  '我喜欢编程',
  '人工智能正在改变世界',
  '机器翻译越来越准确了',
  '开源社区非常活跃',
]

console.log('--- Batch translate: Chinese → English ---')
console.log(`Input: ${texts.length} texts\n`)

const start = Date.now()
const results = await translator.translateBatch(texts, { to: 'en' })
const total = Date.now() - start

for (const [i, r] of results.entries()) {
  console.log(`  [${i + 1}] ${texts[i]}`)
  console.log(`      → ${r.text}`)
  console.log(`      (${r.duration}ms, model: ${r.model})`)
}

console.log(`\nTotal time: ${total}ms`)
console.log(`Avg per text: ${(total / texts.length).toFixed(0)}ms`)

await translator.dispose()
console.log('\nDone!')
