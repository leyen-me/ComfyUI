/**
 * 参考图列表逻辑单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  MAX_REFERENCE_IMAGES,
  addReference,
  addReferences,
  moveReference,
  removeReference,
  reorderReference,
} from '../src/lib/references.ts'

const img = (id) => ({ assetId: id, src: `/assets/${id}`, name: `图${id}.png` })

// 追加与去重
assert.deepEqual(addReference([], img(1)).list, [img(1)])
assert.equal(addReference([img(1)], img(1)).error, '该图片已在参考列表中')
assert.equal(addReference([], { ...img(1), src: '' }).error, '该图片缺少文件内容')

// 上限
const full = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, index) => img(index + 1))
assert.equal(addReference(full, img(99)).error, `参考图最多 ${MAX_REFERENCE_IMAGES} 张`)
const batch = addReferences(full.slice(0, 8), [img(1), img(20), img(21)])
assert.deepEqual(batch.list.map((item) => item.assetId), [1, 2, 3, 4, 5, 6, 7, 8, 20])
assert.equal(batch.error, `参考图最多 ${MAX_REFERENCE_IMAGES} 张`)

// 删除、移动、拖拽排序
assert.deepEqual(removeReference([img(1), img(2), img(3)], 1), [img(1), img(3)])
assert.deepEqual(moveReference([img(1), img(2), img(3)], 0, 1), [img(2), img(1), img(3)])
assert.deepEqual(moveReference([img(1), img(2), img(3)], 0, -1), [img(1), img(2), img(3)])
assert.deepEqual(reorderReference([img(1), img(2), img(3)], 0, 2), [img(2), img(3), img(1)])
assert.deepEqual(reorderReference([img(1), img(2), img(3)], 2, 0), [img(3), img(1), img(2)])

console.log('参考图列表逻辑正常')
