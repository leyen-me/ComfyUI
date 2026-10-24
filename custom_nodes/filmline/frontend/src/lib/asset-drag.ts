import type { AssetSource } from './api'

/** 资产拖拽的统一载荷：左侧列表写入，首尾帧槽位 / 提示词编辑器 / 参考托盘读取。 */
export const ASSET_MIME = 'application/x-filmline-asset'

export type DragAssetKind = 'image' | 'video' | 'audio' | 'text'

export interface AssetDragPayload {
  assetId: number
  /** 媒体文件地址；文本资产没有文件，为空字符串 */
  src: string
  name: string
  kind: DragAssetKind
  /** 文本资产正文；仅 kind === 'text' 时携带 */
  text?: string
  source?: AssetSource
  /** 视频帧率，用于逐帧选择；未知时按 24fps 处理 */
  fps?: number
  /** 视频/音频时长（秒），来自资产 meta 或探测接口 */
  duration?: number
  /** 视频是否带音轨 */
  hasAudio?: boolean
}

export function setAssetDrag(dataTransfer: DataTransfer, payload: AssetDragPayload): void {
  dataTransfer.effectAllowed = 'copy'
  dataTransfer.setData(ASSET_MIME, JSON.stringify(payload))
  // 兜底：拖到浏览器外部或普通输入框时，文本资产给正文，其它给名字
  const plain = payload.kind === 'text' ? (payload.text ?? payload.name) : payload.name
  dataTransfer.setData('text/plain', plain)
}

function dragKind(raw: unknown): DragAssetKind {
  return raw === 'video' || raw === 'audio' || raw === 'text' ? raw : 'image'
}

export function readAssetDrag(dataTransfer: DataTransfer | null): AssetDragPayload | null {
  const raw = dataTransfer?.getData(ASSET_MIME)
  if (!raw) return null

  try {
    const value = JSON.parse(raw) as Partial<AssetDragPayload>
    const assetId = value.assetId
    if (!Number.isInteger(assetId) || (assetId ?? 0) <= 0) return null
    const name = typeof value.name === 'string' ? value.name : ''
    const source =
      value.source === 'ai' ? 'ai' : value.source === 'user' ? 'user' : undefined
    const kind = dragKind(value.kind)

    if (kind === 'text') {
      const text = typeof value.text === 'string' ? value.text : ''
      if (!text.trim()) return null
      return {
        assetId: assetId as number,
        src: typeof value.src === 'string' ? value.src : '',
        name,
        kind,
        text,
        source,
      }
    }

    const src = typeof value.src === 'string' ? value.src : ''
    if (!src) return null
    return {
      assetId: assetId as number,
      src,
      name,
      kind,
      source,
      fps: typeof value.fps === 'number' && value.fps > 0 ? value.fps : undefined,
      duration:
        typeof value.duration === 'number' && value.duration > 0 ? value.duration : undefined,
      hasAudio: typeof value.hasAudio === 'boolean' ? value.hasAudio : undefined,
    }
  } catch {
    return null
  }
}

/** 拖拽时判断当前 DataTransfer 是否携带本应用的资产载荷。 */
export function hasAssetDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(ASSET_MIME))
}
