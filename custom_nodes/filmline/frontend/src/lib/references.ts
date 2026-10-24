import type { AssetDragPayload } from './asset-drag'

/** H3 Ref2VA 官方上限：参考图 ≤9 */
export const MAX_REFERENCE_IMAGES = 9

export interface ReferenceMutation {
  list: AssetDragPayload[]
  error?: string
}

function isSame(a: AssetDragPayload, b: AssetDragPayload): boolean {
  return a.assetId === b.assetId
}

/** 追加一张参考图：去重、校验文件与上限。 */
export function addReference(
  list: AssetDragPayload[],
  asset: AssetDragPayload,
): ReferenceMutation {
  if (!asset.src) return { list, error: '该图片缺少文件内容' }
  if (asset.kind !== 'image') return { list, error: '参考生成目前只支持图片' }
  if (list.some((item) => isSame(item, asset))) {
    return { list, error: '该图片已在参考列表中' }
  }
  if (list.length >= MAX_REFERENCE_IMAGES) {
    return { list, error: `参考图最多 ${MAX_REFERENCE_IMAGES} 张` }
  }
  return { list: [...list, asset] }
}

/** 批量追加（多选选择器），保持选择顺序并忽略重复项。 */
export function addReferences(
  list: AssetDragPayload[],
  assets: AssetDragPayload[],
): ReferenceMutation {
  const next = [...list]
  let error: string | undefined

  for (const asset of assets) {
    if (!asset.src || asset.kind !== 'image') continue
    if (next.some((item) => isSame(item, asset))) continue
    if (next.length >= MAX_REFERENCE_IMAGES) {
      error = `参考图最多 ${MAX_REFERENCE_IMAGES} 张`
      break
    }
    next.push(asset)
  }

  return error ? { list: next, error } : { list: next }
}

export function removeReference(
  list: AssetDragPayload[],
  index: number,
): AssetDragPayload[] {
  if (index < 0 || index >= list.length) return list
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

export function moveReference(
  list: AssetDragPayload[],
  index: number,
  delta: number,
): AssetDragPayload[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  if (!item) return list
  next.splice(target, 0, item)
  return next
}

/** 拖拽排序：把 from 位置的项移动到 to 位置。 */
export function reorderReference(
  list: AssetDragPayload[],
  from: number,
  to: number,
): AssetDragPayload[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  return moveReference(list, from, to - from)
}
