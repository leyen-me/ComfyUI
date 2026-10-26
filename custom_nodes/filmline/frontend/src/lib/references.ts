import type { AssetDragPayload } from './asset-drag'

/** H3 Ref2VA 官方上限：图片 ≤9、视频 ≤3、音频 ≤3，所有文件合计 ≤12 */
export const MAX_REFERENCE_IMAGES = 9
export const MAX_REFERENCE_VIDEOS = 3
export const MAX_REFERENCE_AUDIOS = 3
export const MAX_REFERENCE_FILES = 12
/** 官方 Add Guide 可链式叠加；与后端 generation.MAX_VIDEO_GUIDES 一致 */
export const MAX_REFERENCE_GUIDES = 4

export interface ReferenceVideo extends AssetDragPayload {
  /** 是否把视频原声作为 <Audio j> 参考 */
  useAudio: boolean
  duration?: number
  hasAudio?: boolean
  /** 裁剪入点（秒）；0 表示从开头开始 */
  trimStart?: number
  /** 裁剪出点（秒）；0 表示到结尾 */
  trimEnd?: number
}

export interface ReferenceAudio extends AssetDragPayload {
  duration?: number
}

/** 帧锚定：把一张参考图钉到输出时间轴的指定秒数（官方 Add Guide）。 */
export interface ReferenceGuide extends AssetDragPayload {
  atSeconds: number
}

export interface ReferenceLists {
  images: AssetDragPayload[]
  videos: ReferenceVideo[]
  audios: ReferenceAudio[]
}

export const EMPTY_REFERENCES: ReferenceLists = { images: [], videos: [], audios: [] }

export interface ReferenceMutation {
  list: AssetDragPayload[]
  error?: string
}

export interface VideoMutation {
  list: ReferenceVideo[]
  error?: string
}

export interface AudioMutation {
  list: ReferenceAudio[]
  error?: string
}

function isSame(a: AssetDragPayload, b: AssetDragPayload): boolean {
  return a.assetId === b.assetId
}

export function totalReferences(lists: ReferenceLists): number {
  return lists.images.length + lists.videos.length + lists.audios.length
}

function allIds(lists: ReferenceLists): number[] {
  return [
    ...lists.images.map((item) => item.assetId),
    ...lists.videos.map((item) => item.assetId),
    ...lists.audios.map((item) => item.assetId),
  ]
}

/** 追加一张参考图：去重、校验文件与上限。 */
export function addReference(
  list: AssetDragPayload[],
  asset: AssetDragPayload,
  total = list.length,
): ReferenceMutation {
  if (!asset.src) return { list, error: '该图片缺少文件内容' }
  if (asset.kind !== 'image') return { list, error: '参考图只接受图片资产' }
  if (list.some((item) => isSame(item, asset))) {
    return { list, error: '该图片已在参考列表中' }
  }
  if (list.length >= MAX_REFERENCE_IMAGES) {
    return { list, error: `参考图最多 ${MAX_REFERENCE_IMAGES} 张` }
  }
  if (total >= MAX_REFERENCE_FILES) {
    return { list, error: `参考素材合计最多 ${MAX_REFERENCE_FILES} 个` }
  }
  return { list: [...list, asset] }
}

/** 批量追加图片（多选选择器），保持选择顺序并忽略重复项。 */
export function addReferences(
  list: AssetDragPayload[],
  assets: AssetDragPayload[],
  total = list.length,
): ReferenceMutation {
  const next = [...list]
  let error: string | undefined
  let currentTotal = total

  for (const asset of assets) {
    if (!asset.src || asset.kind !== 'image') continue
    if (next.some((item) => isSame(item, asset))) continue
    if (next.length >= MAX_REFERENCE_IMAGES) {
      error = `参考图最多 ${MAX_REFERENCE_IMAGES} 张`
      break
    }
    if (currentTotal >= MAX_REFERENCE_FILES) {
      error = `参考素材合计最多 ${MAX_REFERENCE_FILES} 个`
      break
    }
    next.push(asset)
    currentTotal += 1
  }

  return error ? { list: next, error } : { list: next }
}

export function addVideo(
  lists: ReferenceLists,
  asset: AssetDragPayload,
  info?: { duration?: number; hasAudio?: boolean; fps?: number },
): VideoMutation {
  if (!asset.src) return { list: lists.videos, error: '该视频缺少文件内容' }
  if (asset.kind !== 'video') return { list: lists.videos, error: '这不是视频资产' }
  if (allIds(lists).includes(asset.assetId)) {
    return { list: lists.videos, error: '该素材已在参考列表中' }
  }
  if (lists.videos.length >= MAX_REFERENCE_VIDEOS) {
    return { list: lists.videos, error: `参考视频最多 ${MAX_REFERENCE_VIDEOS} 段` }
  }
  if (totalReferences(lists) >= MAX_REFERENCE_FILES) {
    return { list: lists.videos, error: `参考素材合计最多 ${MAX_REFERENCE_FILES} 个` }
  }

  const hasAudio = info?.hasAudio ?? asset.hasAudio ?? false
  return {
    list: [
      ...lists.videos,
      {
        ...asset,
        fps: info?.fps ?? asset.fps,
        duration: info?.duration ?? asset.duration,
        hasAudio,
        useAudio: hasAudio,
        trimStart: 0,
        trimEnd: 0,
      },
    ],
  }
}

export function addAudio(
  lists: ReferenceLists,
  asset: AssetDragPayload,
  info?: { duration?: number },
): AudioMutation {
  if (!asset.src) return { list: lists.audios, error: '该音频缺少文件内容' }
  if (asset.kind !== 'audio') return { list: lists.audios, error: '这不是音频资产' }
  if (allIds(lists).includes(asset.assetId)) {
    return { list: lists.audios, error: '该素材已在参考列表中' }
  }
  if (lists.audios.length >= MAX_REFERENCE_AUDIOS) {
    return { list: lists.audios, error: `参考音频最多 ${MAX_REFERENCE_AUDIOS} 段` }
  }
  if (totalReferences(lists) >= MAX_REFERENCE_FILES) {
    return { list: lists.audios, error: `参考素材合计最多 ${MAX_REFERENCE_FILES} 个` }
  }

  return {
    list: [...lists.audios, { ...asset, duration: info?.duration ?? asset.duration }],
  }
}

export function removeReference<T>(list: T[], index: number): T[] {
  if (index < 0 || index >= list.length) return list
  return [...list.slice(0, index), ...list.slice(index + 1)]
}

export function moveReference<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  const [item] = next.splice(index, 1)
  if (item === undefined) return list
  next.splice(target, 0, item)
  return next
}

/** 拖拽排序：把 from 位置的项移动到 to 位置。 */
export function reorderReference<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  return moveReference(list, from, to - from)
}

/** 视频原声在 <Audio j> 中的序号；未启用/没有音轨时为 null。 */
export function soundtrackOrdinal(videos: ReferenceVideo[], index: number): number | null {
  const video = videos[index]
  if (!video?.useAudio || !video.hasAudio) return null
  let ordinal = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    const previous = videos[cursor]
    if (previous?.useAudio && previous.hasAudio) ordinal += 1
  }
  return ordinal
}

/** 独立音频的 <Audio j> 序号：所有视频原声之后。 */
export function standaloneAudioOrdinal(
  videos: ReferenceVideo[],
  _audios: ReferenceAudio[],
  index: number,
): number {
  const soundtracks = videos.filter((video) => video.useAudio && video.hasAudio).length
  return soundtracks + index + 1
}

export function referenceDurationWarning(duration?: number): string | null {
  if (duration === undefined) return null
  if (duration < 1.95 || duration > 15.05) {
    return `时长 ${duration.toFixed(1)} 秒，需在 2–15 秒之间`
  }
  return null
}

/** 独立参考音频：官方不设上限，只要求至少 2 秒。 */
export function audioDurationWarning(duration?: number): string | null {
  if (duration === undefined) return null
  if (duration < 1.95) {
    return `时长 ${duration.toFixed(1)} 秒，至少需要 2 秒`
  }
  return null
}

/** 视频裁剪区间（秒）；未知时长时返回 null。 */
export function videoClipRange(video: ReferenceVideo): [number, number] | null {
  const total = video.duration
  if (total === undefined || total <= 0) return null
  const start = Math.min(Math.max(video.trimStart ?? 0, 0), total)
  const rawEnd = video.trimEnd ?? 0
  const end = rawEnd > 0 ? Math.min(Math.max(rawEnd, 0), total) : total
  return [start, end]
}

/** 裁剪后的有效时长；未知时返回 undefined。 */
export function videoClipDuration(video: ReferenceVideo): number | undefined {
  const range = videoClipRange(video)
  return range ? Math.max(0, range[1] - range[0]) : undefined
}

/** 参考视频每段裁剪后需 2–15 秒。 */
export function videoClipWarning(video: ReferenceVideo): string | null {
  const clip = videoClipDuration(video)
  if (clip === undefined) return null
  if (clip < 1.95 || clip > 15.05) {
    return `裁剪后 ${clip.toFixed(1)} 秒，需在 2–15 秒之间`
  }
  return null
}

/** 参考视频总时长（按裁剪后计算，未知时长为 0）。 */
export function totalVideoClipDuration(videos: ReferenceVideo[]): number {
  return videos.reduce((sum, video) => sum + (videoClipDuration(video) ?? 0), 0)
}
