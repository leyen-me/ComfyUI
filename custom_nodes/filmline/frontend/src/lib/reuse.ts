import type { Asset } from '@/lib/api'
import { assetPrompt, generationMeta } from '@/lib/asset-meta'
import type { ReusePromptDetail } from '@/lib/events'

/** 把 AI 资产的生成参数还原成「复用提示词」事件载荷；无提示词的资产返回 null。 */
export function reuseDetailFor(asset: Asset): ReusePromptDetail | null {
  const prompt = assetPrompt(asset)
  if (!prompt) return null
  const meta = generationMeta(asset)
  const isVideo = asset.kind === 'video'
  return {
    prompt,
    kind: isVideo ? 'video' : 'image',
    size: meta.size,
    tier: meta.tier,
    count: meta.count ?? 1,
    duration: meta.duration ?? 5,
    refIds: meta.ref_ids ?? [],
    ...(isVideo
      ? {
          videoMode:
            meta.video_mode === 'hybrid'
              ? 'hybrid'
              : meta.video_mode === 'reference'
                ? 'reference'
                : 'keyframes',
          // hybrid 与 keyframes 都有显式首尾帧字段；只有旧资产才从 ref_ids 回退
          firstFrameId:
            meta.first_frame_id ??
            (meta.video_mode === 'reference' || meta.video_mode === 'hybrid'
              ? undefined
              : meta.ref_ids?.[0]) ??
            undefined,
          lastFrameId: meta.last_frame_id ?? undefined,
          videoRefIds: meta.ref_video_ids ?? [],
          videoUseAudio: meta.ref_video_use_audio ?? [],
          audioRefIds: meta.ref_audio_ids ?? [],
        }
      : {}),
}
}
