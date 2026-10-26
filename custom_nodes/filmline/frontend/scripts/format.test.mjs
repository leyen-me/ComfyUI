/**
 * 时长格式化单测。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import { formatClock, formatRelative, formatSeconds } from '../src/lib/format.ts'

const seconds = [
  { input: 0, expected: '0 秒' },
  { input: 45, expected: '45 秒' },
  { input: 59.6, expected: '1 分' },
  { input: 60, expected: '1 分' },
  { input: 101.4, expected: '1 分 41 秒' },
  { input: 3599, expected: '59 分 59 秒' },
  { input: 3661, expected: '1 时 01 分' },
]

const clocks = [
  { input: 0, expected: '0:00' },
  { input: 8, expected: '0:08' },
  { input: 101, expected: '1:41' },
  { input: 601, expected: '10:01' },
  { input: 3723, expected: '1:02:03' },
]

let failed = 0
for (const item of seconds) {
  try {
    assert.equal(formatSeconds(item.input), item.expected)
    console.log(`✓ 时长 ${item.input}s → ${item.expected}`)
  } catch (error) {
    failed += 1
    console.error(`✗ 时长 ${item.input}s`, error.message)
  }
}
for (const item of clocks) {
  try {
    assert.equal(formatClock(item.input), item.expected)
    console.log(`✓ 计时 ${item.input}s → ${item.expected}`)
  } catch (error) {
    failed += 1
    console.error(`✗ 计时 ${item.input}s`, error.message)
  }
}

if (failed > 0) process.exit(1)
console.log('\n时长格式化正常')

const NOW = Date.parse('2026-10-26T12:00:00Z')
const relative = [
  { input: '2026-10-26T11:59:40Z', expected: '刚刚' },
  { input: '2026-10-26T11:15:00Z', expected: '45 分钟前' },
  { input: '2026-10-26T02:00:00Z', expected: '10 小时前' },
  { input: '2026-10-23T12:00:00Z', expected: '3 天前' },
  { input: '2027-01-01T00:00:00Z', expected: '刚刚' },
  { input: null, expected: '—' },
  { input: 'bad', expected: 'bad' },
]
for (const { input, expected } of relative) {
  assert.equal(formatRelative(input, NOW), expected, `formatRelative(${input})`)
}
assert.match(formatRelative('2026-09-01T00:00:00Z', NOW), /^2026-09-0[12]$/)
console.log(`formatRelative: ${relative.length + 1} cases ok`)
