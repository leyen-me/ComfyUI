import { FileText, Image as ImageIcon, Video } from 'lucide-react'

import type { AssetKind } from './api'

export const ASSET_KINDS = [
  { value: 'text', label: '文本', icon: FileText, accept: undefined },
  { value: 'image', label: '图片', icon: ImageIcon, accept: 'image/*' },
  { value: 'video', label: '视频', icon: Video, accept: 'video/*' },
] as const satisfies readonly {
  value: AssetKind
  label: string
  icon: typeof FileText
  accept: string | undefined
}[]

export function assetKindMeta(kind: AssetKind) {
  return ASSET_KINDS.find((item) => item.value === kind) ?? ASSET_KINDS[0]
}
