/**
 * 首尾帧比例提示逻辑单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import { ratioLabel, ratioWarning } from '../src/lib/keyframes.ts'

const cases = [
  { name: '精确 16:9 不警告', width: 1344, height: 768, target: '16:9', expected: null },
  { name: '精确 9:16 不警告', width: 768, height: 1344, target: '9:16', expected: null },
  {
    name: '横图放进竖屏：建议 16:9',
    width: 1920,
    height: 1080,
    target: '9:16',
    expected: { label: '16:9', suggested: '16:9' },
  },
  {
    name: '竖图放进横屏：建议 9:16',
    width: 1080,
    height: 1920,
    target: '16:9',
    expected: { label: '9:16', suggested: '9:16' },
  },
  {
    name: '方图没有方向建议',
    width: 1024,
    height: 1024,
    target: '16:9',
    expected: { label: '1:1', suggested: null },
  },
  {
    name: '4:3 横图：已经是横屏输出，不再重复建议',
    width: 1600,
    height: 1200,
    target: '16:9',
    expected: { label: '4:3', suggested: null },
  },
]

for (const item of cases) {
  const actual = ratioWarning(item.width, item.height, item.target)
  assert.deepEqual(actual, item.expected, item.name)
}

assert.equal(ratioLabel(0, 0), '未知比例')
assert.equal(ratioLabel(1000, 1000), '1:1')

console.log('首尾帧比例提示正常')
