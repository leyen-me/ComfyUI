import type { AssetSource } from './api'

/** 资产拖拽的统一载荷：左侧列表写入，首尾帧槽位 / 提示词编辑器 / 参考托盘读取。 */
export const ASSET_MIME = 'application/x-filmline-asset'

export type DragAssetKind = 'image' | 'video' | 'audio'

export interface AssetDragPayload {
  assetId: number
  src: string
  name: string
  kind: DragAssetKind
  source?: AssetSource
  /** 视频帧率，用于逐帧选择；未知时按 24fps 处理 */
  fps?: number
}

export function setAssetDrag(dataTransfer: DataTransfer, payload: AssetDragPayload): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(ASSET_MIME, JSON.stringify(payload))
  // 兜底：拖到浏览器外部或普通输入框时至少是一段可读文本
  dataTransfer.setData('text/plain', payload.name)
}

export function readAssetDrag(dataTransfer: DataTransfer | null): AssetDragPayload | null {
  const raw = dataTransfer?.getData(ASSET_MIME)
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<AssetDragPayload>
    if (
      !Number.isInteger(value.assetId) ||
      (value.assetId ?? 0) <= 0 ||
      typeof value.src !== 'string' ||
      !value.src
    ) {
      return null
    }
    const kind: DragAssetKind =
      value.kind === 'video' || value.kind === 'audio' ? value.kind : 'image'
    return {
      assetId: value.assetId as number,
      src: value.src,
      name: typeof value.name === 'string' ? value.name : '',
      kind,
      source: value.source === 'ai' ? 'ai' : value.source === 'user' ? 'user' : undefined,
      fps: typeof value.fps === 'number' && value.fps > 0 ? value.fps : undefined,
    }
  } catch {
    return null
  }
}

/** 拖拽时判断当前 DataTransfer 是否携带本应用的资产载荷。 */
export function hasAssetDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(ASSET_MIME))
}
