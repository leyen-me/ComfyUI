/**
 * 页码计算逻辑的单元测试（纯函数，无 DOM 依赖）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import { pageItems } from '../src/lib/pagination.ts'

const cases = [
  { name: '0 页', current: 1, count: 0, expected: [] },
  { name: '单页', current: 1, count: 1, expected: [1] },
  { name: '7 页全列', current: 4, count: 7, expected: [1, 2, 3, 4, 5, 6, 7] },
  { name: '首页附近折叠', current: 1, count: 8, expected: [1, 2, 'ellipsis', 8] },
  { name: '中间两侧折叠', current: 5, count: 20, expected: [1, 'ellipsis', 4, 5, 6, 'ellipsis', 20] },
  { name: '末页附近折叠', current: 20, count: 20, expected: [1, 'ellipsis', 19, 20] },
  { name: '倒数第二页', current: 19, count: 20, expected: [1, 'ellipsis', 18, 19, 20] },
]

let failed = 0
for (const item of cases) {
  try {
    assert.deepEqual(pageItems(item.current, item.count), item.expected)
    console.log(`✓ ${item.name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${item.name}`)
    console.error(error)
  }
}

if (failed > 0) process.exit(1)
console.log('\n分页逻辑正常')
