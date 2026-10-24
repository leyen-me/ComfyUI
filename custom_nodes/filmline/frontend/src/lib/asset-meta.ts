import type { Asset } from '@/lib/api'

/** 生成参数（仅 AI 资产有）。字段来自后端 meta。 */
export interface GenerationMeta {
  prompt?: string
  size?: string
  width?: number
  height?: number
  seed?: number
  steps?: number
  cfg?: number
  duration?: number
  count?: number
  ref_ids?: number[]
  model?: string
}

export function generationMeta(asset: Asset): GenerationMeta {
  const meta = (asset.meta ?? {}) as GenerationMeta
  return meta
}

export function assetPrompt(asset: Asset): string | null {
  const prompt = generationMeta(asset).prompt
  return typeof prompt === 'string' && prompt.trim() ? prompt : null
}

/** 图片/视频的尺寸摘要，例如 "16:9 · 1344×768"。 */
export function assetDimensions(asset: Asset): string | null {
  const { size, width, height } = generationMeta(asset)
  const parts: string[] = []
  if (size) parts.push(size)
  if (width && height) parts.push(`${width}×${height}`)
  return parts.length ? parts.join(' · ') : null
}
