/**
 * 资产拖拽载荷单测（纯逻辑，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'

import {
  ASSET_MIME,
  hasAssetDrag,
  readAssetDrag,
  setAssetDrag,
} from '../src/lib/asset-drag.ts'

/** 最小 DataTransfer 替身：只实现读写与 types。 */
function fakeDataTransfer() {
  const store = new Map()
  return {
    effectAllowed: 'none',
    get types() {
      return [...store.keys()]
    },
    setData(type, value) {
      store.set(type, String(value))
    },
    getData(type) {
      return store.get(type) ?? ''
    },
  }
}

// 文本资产：没有文件地址，靠 text 传递正文，并兜底写到 text/plain
{
  const dt = fakeDataTransfer()
  setAssetDrag(dt, {
    assetId: 31,
    src: '',
    name: '第一章第一节',
    kind: 'text',
    text: '风起长安，灯影摇红。',
    source: 'user',
  })
  assert.equal(dt.effectAllowed, 'copy')
  assert.ok(hasAssetDrag(dt))
  const payload = readAssetDrag(dt)
  assert.equal(payload?.kind, 'text')
  assert.equal(payload?.text, '风起长安，灯影摇红。')
  assert.equal(payload?.src, '')
  assert.equal(payload?.source, 'user')
  // 拖到外部应用时拿到的是正文，不是资产名
  assert.equal(dt.getData('text/plain'), '风起长安，灯影摇红。')
}

// 空文本不构成有效拖拽
{
  const dt = fakeDataTransfer()
  dt.setData(ASSET_MIME, JSON.stringify({ assetId: 1, src: '', name: '空', kind: 'text', text: '  ' }))
  assert.equal(readAssetDrag(dt), null)
}

// 媒体资产行为不变，text/plain 仍是资产名
{
  const dt = fakeDataTransfer()
  setAssetDrag(dt, {
    assetId: 7,
    src: '/studio/api/assets/7/content',
    name: 'shot_0001.mp4',
    kind: 'video',
    duration: 2.5,
    hasAudio: true,
  })
  const payload = readAssetDrag(dt)
  assert.equal(payload?.kind, 'video')
  assert.equal(payload?.duration, 2.5)
  assert.equal(payload?.hasAudio, true)
  assert.equal(dt.getData('text/plain'), 'shot_0001.mp4')
}

// 媒体缺少文件地址视为无效；旧载荷没有 kind 时按图片处理
{
  const missing = fakeDataTransfer()
  missing.setData(ASSET_MIME, JSON.stringify({ assetId: 9, name: 'x', kind: 'image' }))
  assert.equal(readAssetDrag(missing), null)

  const legacy = fakeDataTransfer()
  legacy.setData(ASSET_MIME, JSON.stringify({ assetId: 9, src: '/x.png', name: 'x' }))
  assert.equal(readAssetDrag(legacy)?.kind, 'image')
}

// 非本应用载荷不误判
{
  const dt = fakeDataTransfer()
  dt.setData('text/plain', 'hello')
  assert.equal(hasAssetDrag(dt), false)
  assert.equal(readAssetDrag(dt), null)
  assert.equal(readAssetDrag(null), null)
}

console.log('✓ 资产拖拽载荷：文本 / 媒体 / 兼容旧载荷')
