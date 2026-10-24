/**
 * 提示词序列化逻辑单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import { buildPromptDoc, serializePrompt } from '../src/lib/prompt.ts'

const text = (value) => ({ type: { name: 'text' }, text: value })
const chip = (assetId) => ({ type: { name: 'imageChip' }, attrs: { assetId } })
const para = (...nodes) => ({ forEach: (fn) => nodes.forEach(fn) })
const doc = (...blocks) => ({ forEach: (fn) => blocks.forEach(fn) })

const cases = [
  {
    name: '纯文本',
    input: doc(para(text('雪夜长安街'))),
    text: '雪夜长安街',
    refs: [],
  },
  {
    name: '引用块前后都有文字',
    input: doc(para(text('把'), chip(12), text('的人物放到'), chip(37), text('的场景里'))),
    text: '把图1的人物放到图2的场景里',
    refs: [12, 37],
  },
  {
    name: '多段落',
    input: doc(para(text('第一行')), para(chip(5), text('结尾'))),
    text: '第一行\n图1结尾',
    refs: [5],
  },
  {
    name: '只有引用块',
    input: doc(para(chip(9))),
    text: '图1',
    refs: [9],
  },
  {
    name: '空文档',
    input: doc(para()),
    text: '',
    refs: [],
  },
]

let failed = 0
for (const item of cases) {
  try {
    const result = serializePrompt(item.input)
    assert.equal(result.text, item.text)
    assert.deepEqual(result.refs, item.refs)
    console.log(`✓ ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${item.name}`)
    console.error(error.message)
  }
}


// —— buildPromptDoc：把「图N」还原成图片块 ——
const chipsOf = (doc) =>
  (doc.content[0].content ?? []).filter((n) => n.type === 'imageChip').map((n) => n.attrs.assetId)

const docs = [
  {
    name: '无参考图时保持纯文本',
    input: ['让他图1笑起来', []],
    text: '让他图1笑起来',
    chips: [],
  },
  {
    name: '中间引用还原成图片块',
    input: ['让他图1笑起来', [{ assetId: 5, src: '/a' }]],
    chips: [5],
  },
  {
    name: '多张按顺序还原',
    input: ['用图1的场景放图2的人', [{ assetId: 5, src: '/a' }, { assetId: 9, src: '/b' }]],
    chips: [5, 9],
  },
  {
    name: '资产缺失时降级为文字',
    input: ['用图1和图2', [{ assetId: 5, src: '/a' }, null]],
    chips: [5],
  },
]

for (const item of docs) {
  const [text, refs] = item.input
  const doc = buildPromptDoc(text, refs)
  try {
    assert.deepEqual(chipsOf(doc), item.chips)
    console.log(`✓ ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${item.name}`)
    console.error(error.message)
  }
}

if (failed > 0) process.exit(1)
console.log('\n提示词还原正常')
