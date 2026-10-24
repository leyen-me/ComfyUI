/**
 * 视频时长：帧网格对齐与范围校验（纯函数）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'

import {
  DURATION_MAX_SECONDS,
  DURATION_MIN_SECONDS,
  DURATION_PRESETS,
  actualSeconds,
  clampDuration,
  isValidDuration,
  videoFrames,
} from '../src/lib/duration.ts'

// 与后端 generation.video_length 保持一致
assert.equal(videoFrames(5), 124)
assert.equal(videoFrames(8), 192)
assert.equal(videoFrames(10), 243)
assert.equal(videoFrames(15), 362)

// 5–15 秒都落在 17k+5 网格，且不越出训练区间 124–362 帧
for (let seconds = DURATION_MIN_SECONDS; seconds <= DURATION_MAX_SECONDS; seconds += 1) {
  const frames = videoFrames(seconds)
  assert.equal(frames % 17, 5, `${seconds}s -> ${frames} 帧不在网格上`)
  assert.ok(frames >= 124 && frames <= 362, `${seconds}s -> ${frames} 帧越界`)
  assert.ok(frames >= seconds * 24, '帧数应向上对齐')
}

assert.equal(actualSeconds(5).toFixed(2), '5.17')
assert.equal(actualSeconds(15).toFixed(2), '15.08')

assert.equal(isValidDuration(5), true)
assert.equal(isValidDuration(15), true)
assert.equal(isValidDuration(4), false)
assert.equal(isValidDuration(16), false)
assert.equal(isValidDuration(7.5), false)
assert.equal(isValidDuration(Number.NaN), false)

assert.equal(clampDuration(3), 5)
assert.equal(clampDuration(99), 15)
assert.equal(clampDuration(7.4), 7)
assert.equal(clampDuration(Number.NaN), 5)

assert.deepEqual([...DURATION_PRESETS], [5, 8, 10, 12, 15])

console.log('✓ 视频时长：帧网格对齐与范围校验')
