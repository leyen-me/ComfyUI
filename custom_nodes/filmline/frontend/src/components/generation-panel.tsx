import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, Sparkles, Video, Wand2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import {
  ApiError,
  api,
  type Asset,
  type Project,
  type PromptOptimizeImage,
  type PromptOptimizeReference,
  type PromptOptimizeResult,
  type PromptOptimizeVideoFrame,
  type TaskInfo,
} from '@/lib/api'
import type { AssetDragPayload } from '@/lib/asset-drag'
import { isValidDuration } from '@/lib/duration'
import type { KeyframeSlot } from '@/lib/keyframes'
import { buildPromptDoc, type RefAsset } from '@/lib/prompt'
import { readClientName } from '@/lib/client-name'
import { lintPrompt } from '@/lib/prompt-assistant'
import {
  EMPTY_REFERENCES,
  MAX_REFERENCE_AUDIOS,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_GUIDES,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_VIDEOS,
  addAudio,
  addReference,
  addReferences,
  addVideo,
  audioDurationWarning,
  moveReference,
  reorderReference,
  removeReference,
  soundtrackOrdinal,
  standaloneAudioOrdinal,
  totalReferences,
  totalVideoClipDuration,
  videoClipWarning,
  type ReferenceGuide,
  type ReferenceLists,
  type ReferenceVideo,
} from '@/lib/references'
import { emitAssetsChanged, REUSE_PROMPT, type ReusePromptDetail } from '@/lib/events'
import { cn } from '@/lib/utils'
import { formatClock } from '@/lib/format'
import { GenerationStage } from './generation-stage'
import { Popover } from './ui/popover'
import { segmentGroupClass, segmentItemClass } from './ui/segmented'
import { AssetPickerDialog } from './asset-picker-dialog'
import { DurationSelect } from './duration-select'
import { GenerationOptions } from './generation-options'
import { KeyframeSlots } from './keyframe-slots'
import { PromptInput, type PromptInputHandle } from './prompt-input'
import { PromptAssistant } from './prompt-assistant'
import { PromptOptimizeDialog } from './prompt-optimize-dialog'
import type { PromptValue } from './prompt-editor'
import { ReferenceTray } from './reference-tray'
import {
  ReferenceSettings,
  type RefImageSize,
  type RefQuality,
  type RefScheduler,
} from './reference-settings'
import { VideoFrameDialog } from './video-frame-dialog'
import { VideoTrimDialog } from './video-trim-dialog'
import { Button } from './ui/button'
import { Select } from './ui/select'

type Mode = 'image' | 'video'
type VideoMode = 'keyframes' | 'reference'
type DraftKey = 'image' | 'keyframes' | 'reference'
type PickerState =
  | { type: 'keyframe'; slot: KeyframeSlot }
  | { type: 'reference'; kind: 'image' | 'video' | 'audio' }
  | { type: 'guide' }
  | null

const COUNTS = [1, 2, 3, 4]
/** 与后端 generation.MAX_IMAGE_REFS 保持一致 */
const MAX_IMAGE_REFS = 10
const EMPTY_VALUE: PromptValue = { text: '', refs: [] }

interface Keyframes {
  first: AssetDragPayload | null
  last: AssetDragPayload | null
}

const EMPTY_KEYFRAMES: Keyframes = { first: null, last: null }

interface GenerationPanelProps {
  project: Project
  /** 为空表示项目级 */
  episodeCode?: string
}

export function GenerationPanel({ project, episodeCode }: GenerationPanelProps) {
  const navigate = useNavigate()
  const editorRef = useRef<PromptInputHandle>(null)

  const [mode, setMode] = useState<Mode>('image')
  const [videoMode, setVideoMode] = useState<VideoMode>('keyframes')
  const [value, setValue] = useState<PromptValue>(EMPTY_VALUE)
  const [keyframes, setKeyframes] = useState<Keyframes>(EMPTY_KEYFRAMES)
  const [referenceLists, setReferenceLists] = useState<ReferenceLists>(EMPTY_REFERENCES)
  const referenceListsRef = useRef<ReferenceLists>(EMPTY_REFERENCES)
  referenceListsRef.current = referenceLists
  const [guides, setGuides] = useState<ReferenceGuide[]>([])
  const [trimTarget, setTrimTarget] = useState<{
    index: number
    video: ReferenceVideo
  } | null>(null)
  const [picker, setPicker] = useState<PickerState>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const assistantAnchorRef = useRef<HTMLButtonElement>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [optimizeOpen, setOptimizeOpen] = useState(false)
  const [optimizeOriginal, setOptimizeOriginal] = useState('')
  const [optimizeResult, setOptimizeResult] = useState<PromptOptimizeResult | null>(null)
  const [videoFrame, setVideoFrame] = useState<{
    slot: KeyframeSlot
    video: AssetDragPayload
  } | null>(null)
  const [imageSize, setImageSize] = useState<string>('16:9')
  const [imageTier, setImageTier] = useState<string>('1k')
  const [videoSize, setVideoSize] = useState<string>('16:9')
  const [videoTier, setVideoTier] = useState<string>('768')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [autoDuration, setAutoDuration] = useState(false)
  const [refQuality, setRefQuality] = useState<RefQuality>('quality')
  const [refScheduler, setRefScheduler] = useState<RefScheduler>('simple')
  const [refImageSize, setRefImageSize] = useState<RefImageSize>('match')
  const [seedEnabled, setSeedEnabled] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2147483647))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<number | null>(null)
  const taskTokenRef = useRef(0)
  // 图片模式带图片块，两种视频模式提示词语义不同，分开暂存避免丢内容或串味
  const draftsRef = useRef<Record<DraftKey, unknown>>({
    image: null,
    keyframes: null,
    reference: null,
  })
  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode
  const videoModeRef = useRef<VideoMode>(videoMode)
  videoModeRef.current = videoMode

  const hasRefs = mode === 'image' && value.refs.length > 0
  const maxRefs = mode === 'image' ? MAX_IMAGE_REFS : 0
  const usesReferences = mode === 'video' && videoMode === 'reference'
  const referenceTotal = totalReferences(referenceLists)
  const missingReference = usesReferences && referenceTotal === 0
  const keyframeHint =
    mode === 'video' && videoMode === 'keyframes'
      ? keyframes.first && keyframes.last
        ? '首尾帧已锁定'
        : keyframes.first
          ? '首帧已锁定'
          : keyframes.last
            ? '尾帧已锁定'
            : null
      : null
  const referenceHint = usesReferences && referenceTotal > 0 ? `已引用 ${referenceTotal} 个参考素材` : null
  const referenceHasAudio =
    referenceLists.audios.length > 0 ||
    referenceLists.videos.some((video) => video.useAudio && video.hasAudio !== false)
  const canAutoDuration = usesReferences && referenceHasAudio
  const pickerKind = picker?.type === 'reference' ? picker.kind : 'image'
  const pickerLimit =
    pickerKind === 'image'
      ? MAX_REFERENCE_IMAGES
      : pickerKind === 'video'
        ? MAX_REFERENCE_VIDEOS
        : MAX_REFERENCE_AUDIOS
  const pickerItems =
    pickerKind === 'image'
      ? referenceLists.images
      : pickerKind === 'video'
        ? referenceLists.videos
        : referenceLists.audios
  const pickerMax =
    picker?.type === 'guide'
      ? Math.max(0, MAX_REFERENCE_GUIDES - guides.length)
      : Math.max(
          0,
          Math.min(pickerLimit - pickerItems.length, MAX_REFERENCE_FILES - referenceTotal),
        )
  const pickerTitle =
    picker?.type === 'guide'
      ? '添加帧锚定图片'
      : pickerKind === 'image'
        ? '添加参考图片'
        : pickerKind === 'video'
          ? '添加参考视频'
          : '添加参考音频'
  const assistantMode = mode === 'image' ? 'image' : 'video'
  const assistantCounts = {
    images: referenceLists.images.length,
    videos: referenceLists.videos.length,
    audios: referenceLists.audios.length,
  }
  const assistantKeyframes = {
    first: Boolean(keyframes.first),
    last: Boolean(keyframes.last),
  }
  const assistantWarnings = lintPrompt({
    mode: assistantMode,
    videoMode,
    prompt: value.text,
    counts: assistantCounts,
  })

  useEffect(() => {
    return () => {
      taskTokenRef.current += 1
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  // 没有可用参考音频时自动时长没有意义，避免提交后才报错
  useEffect(() => {
    if (!canAutoDuration && autoDuration) setAutoDuration(false)
  }, [canAutoDuration, autoDuration])

  function replaceEditorDoc(doc: unknown) {
    if (doc) {
      editorRef.current?.setDoc(doc)
      return
    }
    editorRef.current?.clear()
    setValue(EMPTY_VALUE)
  }

  function draftKey(): DraftKey {
    return modeRef.current === 'image' ? 'image' : videoModeRef.current
  }

  function switchMode(next: Mode) {
    if (running || next === modeRef.current) return

    draftsRef.current[draftKey()] = editorRef.current?.getDoc() ?? null
    modeRef.current = next
    setMode(next)
    setError(null)
    replaceEditorDoc(
      draftsRef.current[next === 'image' ? 'image' : videoModeRef.current],
    )

    if (next === 'video' && !['16:9', '9:16', '1:1'].includes(videoSize)) {
      setVideoSize('16:9')
    }
  }
  const switchModeRef = useRef(switchMode)
  switchModeRef.current = switchMode

  function switchVideoMode(next: VideoMode) {
    if (running || next === videoModeRef.current) return

    draftsRef.current[draftKey()] = editorRef.current?.getDoc() ?? null
    videoModeRef.current = next
    setVideoMode(next)
    setError(null)
    replaceEditorDoc(draftsRef.current[next])
  }
  const switchVideoModeRef = useRef(switchVideoMode)
  switchVideoModeRef.current = switchVideoMode

  // 资产预览里点“用此提示词生成”：回填模式、参数与参考素材
  useEffect(() => {
    async function onReuse(event: Event) {
      const detail = (event as CustomEvent<ReusePromptDetail>).detail

      if (detail.kind === 'video') {
        const targetVideoMode: VideoMode =
          detail.videoMode === 'reference' ? 'reference' : 'keyframes'
        switchModeRef.current('video')
        switchVideoModeRef.current(targetVideoMode)
        if (detail.size === '16:9' || detail.size === '9:16' || detail.size === '1:1') {
          setVideoSize(detail.size)
        }
        if (detail.tier === '768' || detail.tier === '0.4') setVideoTier(detail.tier)
        setAutoDuration(Boolean(detail.autoDuration))
        if (
          detail.refQuality === 'quality' ||
          detail.refQuality === 'fast'
        ) {
          setRefQuality(detail.refQuality)
        }
        if (
          detail.refScheduler === 'simple' ||
          detail.refScheduler === 'beta' ||
          detail.refScheduler === 'normal'
        ) {
          setRefScheduler(detail.refScheduler)
        }
        if (detail.refImageSize === 'match' || detail.refImageSize === 'max') {
          setRefImageSize(detail.refImageSize)
        }
        if (typeof detail.seed === 'number') setSeed(detail.seed)
        if (typeof detail.duration === 'number' && isValidDuration(detail.duration)) {
          setDuration(detail.duration)
        }

        if (targetVideoMode !== 'keyframes') {
          const imageIds = detail.refIds ?? []
          const videoIds = detail.videoRefIds ?? []
          const audioIds = detail.audioRefIds ?? []
          const useAudio = detail.videoUseAudio ?? []
          const guideFrames = detail.guideFrames ?? []

          const [imageAssets, videoAssets, audioAssets, guideAssets] = await Promise.all([
            Promise.all(
              imageIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
            ),
            Promise.all(
              videoIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
            ),
            Promise.all(
              audioIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
            ),
            Promise.all(
              guideFrames.map((item) =>
                api.projects.assets.get(item.assetId).catch(() => null),
              ),
            ),
          ])

          const images = imageAssets
            .map((asset) => toDragPayload(asset))
            .filter((asset): asset is AssetDragPayload => Boolean(asset) && asset?.kind === 'image')
          const videos = await Promise.all(
            videoAssets.map(async (asset, index) => {
              const payload = toDragPayload(asset)
              if (!payload || payload.kind !== 'video') return null
              let duration = payload.duration
              let hasAudio = payload.hasAudio
              let fps = payload.fps
              if (duration === undefined || hasAudio === undefined) {
                try {
                  const info = await api.projects.assets.mediaInfo(payload.assetId)
                  duration = info.duration
                  hasAudio = info.has_audio
                  fps = info.fps ?? fps
                } catch {
                  /* 探测失败仍允许还原，生成时会再次校验 */
                }
              }
              const trim = detail.videoTrims?.[index]
              return {
                ...payload,
                duration,
                hasAudio,
                fps,
                useAudio: Boolean(useAudio[index] ?? hasAudio) && hasAudio !== false,
                trimStart: typeof trim?.[0] === 'number' ? trim[0] : 0,
                trimEnd: typeof trim?.[1] === 'number' ? trim[1] : 0,
              }
            }),
          )
          const audios = await Promise.all(
            audioAssets.map(async (asset) => {
              const payload = toDragPayload(asset)
              if (!payload || payload.kind !== 'audio') return null
              let duration = payload.duration
              if (duration === undefined) {
                try {
                  const info = await api.projects.assets.mediaInfo(payload.assetId)
                  duration = info.duration
                } catch {
                  /* 同上 */
                }
              }
              return { ...payload, duration }
            }),
          )

          const next: ReferenceLists = {
            images: images.slice(0, MAX_REFERENCE_IMAGES),
            videos: videos
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
              .slice(0, MAX_REFERENCE_VIDEOS),
            audios: audios
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
              .slice(0, MAX_REFERENCE_AUDIOS),
          }
          referenceListsRef.current = next
          setReferenceLists(next)
          setGuides(
            guideAssets
              .map((asset, index) => {
                const payload = toDragPayload(asset)
                if (!payload || payload.kind !== 'image') return null
                return {
                  ...payload,
                  atSeconds: guideFrames[index]?.atSeconds ?? 0,
                }
              })
              .filter((item): item is ReferenceGuide => Boolean(item))
              .slice(0, MAX_REFERENCE_GUIDES),
          )
          if (totalReferences(next) === 0) {
            setError('这条视频没有可还原的参考素材')
          } else if (
            images.length !== imageIds.length ||
            videos.some((item) => !item) ||
            audios.some((item) => !item)
          ) {
            setError('部分参考素材资产已删除，已跳过')
          }
        }
        if (targetVideoMode === 'keyframes') {
          // 新数据用显式首尾帧字段；旧视频资产只有 ref_ids（最多 1 个），按首帧还原。
          const firstId = detail.firstFrameId ?? detail.refIds?.[0]
          const lastId = detail.lastFrameId
          const [firstAsset, lastAsset] = await Promise.all(
            [firstId, lastId].map((id) =>
              id ? api.projects.assets.get(id).catch(() => null) : Promise.resolve(null),
            ),
          )
          setKeyframes({
            first: toDragPayload(firstAsset),
            last: toDragPayload(lastAsset),
          })
          if ((firstId && !firstAsset) || (lastId && !lastAsset)) {
            setError('首帧或尾帧资产已删除，已跳过')
          }
        }

        editorRef.current?.setText(detail.prompt)
        editorRef.current?.focus()
        return
      }

      switchModeRef.current('image')
      if (detail.size === '16:9' || detail.size === '9:16' || detail.size === '1:1') {
        setImageSize(detail.size)
      }
      if (detail.tier === '1k' || detail.tier === '2k') setImageTier(detail.tier)
      if (typeof detail.count === 'number' && detail.count >= 1 && detail.count <= 4) {
        setCount(detail.count)
      }

      const refIds = detail.refIds ?? []
      if (refIds.length > 0) {
        // 还原参考图块；已被删除的资产保留为普通文字「图N」
        const loaded = await Promise.all(
          refIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
        )
        const refs: Array<RefAsset | null> = loaded.map((asset) =>
          asset ? { assetId: asset.id, src: asset.content_url ?? '' } : null,
        )
        editorRef.current?.setDoc(buildPromptDoc(detail.prompt, refs))
      } else {
        editorRef.current?.setText(detail.prompt)
      }
      editorRef.current?.focus()
    }

    window.addEventListener(REUSE_PROMPT, onReuse)
    return () => window.removeEventListener(REUSE_PROMPT, onReuse)
  }, [])

  function setKeyframe(slot: KeyframeSlot, asset: AssetDragPayload) {
    const other = slot === 'first' ? keyframes.last : keyframes.first
    if (other?.assetId === asset.assetId) {
      setError('同一张图片不能同时作为首帧和尾帧')
      return
    }
    setError(null)
    setKeyframes((previous) => ({ ...previous, [slot]: asset }))
  }

  function handleKeyframeDrop(slot: KeyframeSlot, asset: AssetDragPayload) {
    if (asset.kind === 'video') {
      setVideoFrame({ slot, video: asset })
      return
    }
    if (asset.kind !== 'image') {
      setError('首尾帧只支持图片或视频')
      return
    }
    setKeyframe(slot, asset)
  }

  function handleFrameExtracted(asset: Asset) {
    if (!videoFrame) return
    const payload = toDragPayload(asset)
    if (!payload) {
      setError('提取的帧缺少文件内容')
      return
    }
    setKeyframe(videoFrame.slot, payload)
    setVideoFrame(null)
  }

  function commitReferences(next: ReferenceLists) {
    referenceListsRef.current = next
    setReferenceLists(next)
  }

  async function enrichMedia(asset: AssetDragPayload) {
    if (asset.kind === 'image') return asset
    if (asset.duration !== undefined && asset.hasAudio !== undefined) return asset
    try {
      const info = await api.projects.assets.mediaInfo(asset.assetId)
      return {
        ...asset,
        duration: info.duration,
        hasAudio: info.has_audio,
        fps: info.fps ?? asset.fps,
      }
    } catch {
      return asset
    }
  }

  async function addReferenceAsset(asset: AssetDragPayload) {
    if (asset.kind === 'text') {
      setError('文本资产请拖到提示词输入框')
      return
    }
    if (asset.kind === 'image') {
      const result = addReference(
        referenceListsRef.current.images,
        asset,
        totalReferences(referenceListsRef.current),
      )
      commitReferences({ ...referenceListsRef.current, images: result.list })
      setError(result.error ?? null)
      return
    }

    const enriched = await enrichMedia(asset)
    const current = referenceListsRef.current
    if (enriched.kind === 'video') {
      const result = addVideo(current, enriched, {
        duration: enriched.duration,
        hasAudio: enriched.hasAudio,
        fps: enriched.fps,
      })
      commitReferences({ ...current, videos: result.list })
      setError(result.error ?? null)
    } else {
      const result = addAudio(current, enriched, { duration: enriched.duration })
      commitReferences({ ...current, audios: result.list })
      setError(result.error ?? null)
    }
  }

  async function addReferenceAssets(assets: Asset[], kind: 'image' | 'video' | 'audio') {
    const payloads = assets
      .map((asset) => toDragPayload(asset))
      .filter((asset): asset is AssetDragPayload => Boolean(asset))

    if (kind === 'image') {
      const result = addReferences(
        referenceListsRef.current.images,
        payloads,
        totalReferences(referenceListsRef.current),
      )
      commitReferences({ ...referenceListsRef.current, images: result.list })
      setError(result.error ?? null)
      setPicker(null)
      return
    }

    let next = referenceListsRef.current
    let error: string | undefined
    for (const payload of payloads) {
      const enriched = await enrichMedia(payload)
      if (kind === 'video') {
        const result = addVideo(next, enriched, {
          duration: enriched.duration,
          hasAudio: enriched.hasAudio,
          fps: enriched.fps,
        })
        next = { ...next, videos: result.list }
        error = result.error
        if (error) break
      } else {
        const result = addAudio(next, enriched, { duration: enriched.duration })
        next = { ...next, audios: result.list }
        error = result.error
        if (error) break
      }
    }
    commitReferences(next)
    setError(error ?? null)
    setPicker(null)
  }

  function removeReferenceItem(kind: 'image' | 'video' | 'audio', index: number) {
    const current = referenceListsRef.current
    if (kind === 'image') {
      commitReferences({ ...current, images: removeReference(current.images, index) })
    } else if (kind === 'video') {
      commitReferences({ ...current, videos: removeReference(current.videos, index) })
    } else {
      commitReferences({ ...current, audios: removeReference(current.audios, index) })
    }
  }

  function moveReferenceItem(
    kind: 'image' | 'video' | 'audio',
    index: number,
    delta: -1 | 1,
  ) {
    const current = referenceListsRef.current
    if (kind === 'image') {
      commitReferences({ ...current, images: moveReference(current.images, index, delta) })
    } else if (kind === 'video') {
      commitReferences({ ...current, videos: moveReference(current.videos, index, delta) })
    } else {
      commitReferences({ ...current, audios: moveReference(current.audios, index, delta) })
    }
  }

  function reorderReferenceItem(
    kind: 'image' | 'video' | 'audio',
    from: number,
    to: number,
  ) {
    const current = referenceListsRef.current
    if (kind === 'image') {
      commitReferences({ ...current, images: reorderReference(current.images, from, to) })
    } else if (kind === 'video') {
      commitReferences({ ...current, videos: reorderReference(current.videos, from, to) })
    } else {
      commitReferences({ ...current, audios: reorderReference(current.audios, from, to) })
    }
  }

  function toggleVideoAudio(index: number) {
    const current = referenceListsRef.current
    const videos = current.videos.map((video, cursor) =>
      cursor === index ? { ...video, useAudio: !video.useAudio } : video,
    )
    commitReferences({ ...current, videos })
  }

  function trimVideo(index: number, start: number, end: number) {
    const current = referenceListsRef.current
    const videos = current.videos.map((video, cursor) =>
      cursor === index ? { ...video, trimStart: start, trimEnd: end } : video,
    )
    commitReferences({ ...current, videos })
  }

  function handlePicked(asset: Asset) {
    if (!picker) return
    const payload = toDragPayload(asset)
    if (!payload) {
      setError('该图片缺少文件内容')
      return
    }
    if (picker.type === 'guide') {
      if (payload.kind !== 'image') {
        setError('帧锚定只接受图片资产')
        return
      }
      if (guides.length >= MAX_REFERENCE_GUIDES) {
        setError(`帧锚定最多 ${MAX_REFERENCE_GUIDES} 个`)
        return
      }
      setGuides((current) => [...current, { ...payload, atSeconds: 0 }])
      setPicker(null)
      return
    }
    if (picker.type !== 'keyframe') return
    setKeyframe(picker.slot, payload)
    setPicker(null)
  }

  function removeGuide(index: number) {
    setGuides((current) => current.filter((_, cursor) => cursor !== index))
  }

  function changeGuideSeconds(index: number, seconds: number) {
    setGuides((current) =>
      current.map((guide, cursor) =>
        cursor === index ? { ...guide, atSeconds: seconds } : guide,
      ),
    )
  }

  function addGuides(assets: Asset[]) {
    const added = assets
      .map((asset) => toDragPayload(asset))
      .filter((item): item is AssetDragPayload => Boolean(item) && item?.kind === 'image')
      .map((item) => ({ ...item, atSeconds: 0 }))
    if (!added.length) {
      setError('帧锚定只接受图片资产')
      return
    }
    setGuides((current) => [...current, ...added].slice(0, MAX_REFERENCE_GUIDES))
    setPicker(null)
  }

  function optimizeReferences(): PromptOptimizeReference[] {
    const result: PromptOptimizeReference[] = []
    referenceLists.images.forEach((_, index) => {
      result.push({ label: `<Picture ${index + 1}>`, kind: 'image' })
    })
    referenceLists.videos.forEach((_, index) => {
      result.push({ label: `<Video ${index + 1}>`, kind: 'video' })
      const ordinal = soundtrackOrdinal(referenceLists.videos, index)
      if (ordinal) result.push({ label: `<Audio ${ordinal}>`, kind: 'audio' })
    })
    referenceLists.audios.forEach((_, index) => {
      result.push({
        label: `<Audio ${standaloneAudioOrdinal(referenceLists.videos, referenceLists.audios, index)}>`,
        kind: 'audio',
      })
    })
    return result
  }

  function optimizeImages(): PromptOptimizeImage[] {
    if (videoMode === 'keyframes') {
      const images: PromptOptimizeImage[] = []
      if (keyframes.first) {
        images.push({
          asset_id: keyframes.first.assetId,
          label: '<Picture 1>',
          role: 'first_frame',
        })
      }
      if (keyframes.last) {
        images.push({
          asset_id: keyframes.last.assetId,
          label: keyframes.first ? '<Picture 2>' : '<Picture 1>',
          role: 'last_frame',
        })
      }
      return images
    }

    return referenceLists.images.slice(0, 4).map((item, index) => ({
      asset_id: item.assetId,
      label: `<Picture ${index + 1}>`,
      role: 'reference',
    }))
  }

  /** 参考视频抽帧：单段取 3 帧，多段各取 2 帧，总帧数不超过 6。 */
  function optimizeVideoFrames(): PromptOptimizeVideoFrame[] {
    if (videoMode !== 'reference') return []
    const videos = referenceLists.videos.slice(0, 3)
    const count = videos.length <= 1 ? 3 : 2
    return videos.map((item, index) => ({
      asset_id: item.assetId,
      label: `<Video ${index + 1}>`,
      start: item.trimStart ?? 0,
      end: item.trimEnd ?? 0,
      count,
    }))
  }

  async function handleOptimize() {
    if (optimizing) return
    if (mode !== 'video') {
      setOptimizeError('AI 优化目前只支持视频提示词')
      return
    }
    const prompt = value.text.trim()
    if (!prompt) {
      setOptimizeError('请先写下提示词，再让 AI 优化')
      return
    }

    setOptimizing(true)
    setOptimizeError(null)
    try {
      const result = await api.prompts.optimize({
        mode: 'video',
        video_mode: videoMode,
        prompt,
        project_ref: project.code,
        keyframes: assistantKeyframes,
        references: optimizeReferences(),
        images: optimizeImages(),
        video_frames: optimizeVideoFrames(),
        size: videoSize,
        duration,
        no_subtitles: true,
      })
      setOptimizeOriginal(prompt)
      setOptimizeResult(result)
      setOptimizeOpen(true)
    } catch (cause) {
      setOptimizeError(
        cause instanceof ApiError
          ? cause.fullMessage
          : cause instanceof Error
            ? cause.message
            : 'AI 优化失败',
      )
    } finally {
      setOptimizing(false)
    }
  }

  function applyOptimized(text: string) {
    editorRef.current?.setText(text)
    editorRef.current?.focus()
    setOptimizeOpen(false)
    setOptimizeResult(null)
    setOptimizeError(null)
  }

  async function waitForTask(taskId: number, token: number): Promise<TaskInfo> {
    let failures = 0
    while (token === taskTokenRef.current) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000))
      if (token !== taskTokenRef.current) break
      try {
        const task = await api.tasks.get(taskId)
        failures = 0
        if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled') {
          return task
        }
      } catch {
        failures += 1
        if (failures >= 5) {
          throw new Error('无法获取任务状态，任务仍在后台执行，可在右上角任务队列查看')
        }
      }
    }
    throw new Error('任务状态轮询已取消')
  }

  function buildVideoPayload(prompt: string, clientLabel: string) {
    const base = {
      kind: 'video' as const,
      prompt,
      size: videoSize,
      resolution: videoTier,
      duration,
      client_label: clientLabel,
      ...(seedEnabled ? { seed } : {}),
    }
    if (videoMode === 'keyframes') {
      return {
        ...base,
        mode: 'keyframes' as const,
        first_frame_id: keyframes.first?.assetId ?? null,
        last_frame_id: keyframes.last?.assetId ?? null,
      }
    }

    return {
      ...base,
      mode: 'reference' as const,
      refs: referenceLists.images.map((item) => item.assetId),
      ref_videos: referenceLists.videos.map((item) => ({
        asset_id: item.assetId,
        use_audio: item.useAudio && item.hasAudio !== false,
        trim_start: item.trimStart ?? 0,
        trim_end: item.trimEnd ?? 0,
      })),
      ref_audios: referenceLists.audios.map((item) => item.assetId),
      ref_guides: guides.map((guide) => ({
        asset_id: guide.assetId,
        at_seconds: guide.atSeconds,
      })),
      auto_duration: autoDuration,
      ref_quality: refQuality,
      ref_scheduler: refScheduler,
      ref_image_size: refImageSize,
    }
  }

  async function handleSubmit() {
    if (running) return
    const current = editorRef.current?.getValue() ?? value
    if (!current.text.trim()) return
    if (usesReferences && referenceTotal === 0) {
      setError('参考生成至少需要 1 个素材')
      return
    }
    if (usesReferences) {
      const badVideo = referenceLists.videos.some((item) => videoClipWarning(item))
      const badAudio = referenceLists.audios.some((item) => audioDurationWarning(item.duration))
      if (badVideo || badAudio || totalVideoClipDuration(referenceLists.videos) > 15.05) {
        setError('参考视频每段裁剪后需 2–15 秒且总时长 ≤15 秒；参考音频每段至少 2 秒')
        return
      }
      const guideLimit = autoDuration ? 15 : duration
      if (guides.some((guide) => guide.atSeconds >= guideLimit)) {
        setError(`帧锚定时间必须小于视频时长（${guideLimit} 秒）`)
        return
      }
    }

    setRunning(true)
    setError(null)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((previous) => previous + 1), 1000)

    const base = episodeCode
      ? `/projects/${project.code}/episodes/${episodeCode}/assets`
      : `/projects/${project.code}/assets`

    const token = ++taskTokenRef.current
    const clientLabel = readClientName()
    try {
      const { task } = await api.projects.generate(
        project.code,
        mode === 'image'
          ? {
              kind: 'image',
              prompt: current.text,
              size: imageSize,
              resolution: imageTier,
              count: hasRefs ? 1 : count,
              refs: current.refs,
              client_label: clientLabel,
            }
          : buildVideoPayload(current.text, clientLabel),
        episodeCode,
      )

      if (task.id === null) throw new Error('任务创建失败')
      const final = await waitForTask(task.id, token)
      if (token !== taskTokenRef.current) return
      if (final.status !== 'succeeded') {
        setError(
          final.status === 'cancelled'
            ? '任务已取消'
            : final.error || '生成失败，任务仍在右上角任务队列中',
        )
        return
      }

      // 参考素材保留下来方便连续微调，只清空提示词草稿
      draftsRef.current[draftKey()] = null
      editorRef.current?.clear()
      setValue(EMPTY_VALUE)
      emitAssetsChanged()
      navigate(`${base}/${mode}`)
    } catch (cause) {
      if (token !== taskTokenRef.current) return
      setError(
        cause instanceof ApiError
          ? cause.fullMessage
          : cause instanceof Error
            ? cause.message
            : '生成失败',
      )
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      setRunning(false)
    }
  }

  return (
    <aside className="flex min-w-0 flex-1 flex-col">
      <GenerationStage
        projectRef={project.code}
        episodeCode={episodeCode}
        running={running}
        runningKind={mode}
        elapsed={elapsed}
      />
      <div className="relative shrink-0 px-6 pt-2 pb-5 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-background before:to-transparent">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
          className="mx-auto w-full max-w-3xl"
        >
          <div className="rounded-[20px] border border-border bg-elevated p-3 shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-[var(--shadow-pop)]">
            {mode === 'video' ? (
              <div className="flex flex-wrap items-center gap-2 px-1 pt-0.5 pb-2">
                <span className="text-[11px] font-medium text-muted-foreground">视频方式</span>
                <div
                  className={segmentGroupClass}
                  role="group"
                  aria-label="视频生成方式"
                >
                  <VideoModeTab
                    active={videoMode === 'keyframes'}
                    onClick={() => switchVideoMode('keyframes')}
                  >
                    首尾帧
                  </VideoModeTab>
                  <VideoModeTab
                    active={videoMode === 'reference'}
                    onClick={() => switchVideoMode('reference')}
                  >
                    参考生成
                  </VideoModeTab>
                </div>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {videoMode === 'keyframes'
                    ? '留空即文生视频'
                    : '参考素材不锁定首帧'}
                </span>
              </div>
            ) : null}

            {mode === 'video' && videoMode === 'keyframes' ? (
              <KeyframeSlots
                first={keyframes.first}
                last={keyframes.last}
                size={videoSize}
                disabled={running}
                onPick={(slot) => setPicker({ type: 'keyframe', slot })}
                onClear={(slot) =>
                  setKeyframes((previous) => ({ ...previous, [slot]: null }))
                }
                onDropAsset={handleKeyframeDrop}
                onSwap={() =>
                  setKeyframes((previous) => ({ first: previous.last, last: previous.first }))
                }
                onUseRatio={(next) => setVideoSize(next)}
              />
            ) : null}

            {usesReferences ? (
              <ReferenceTray
                lists={referenceLists}
                disabled={running}
                onAdd={(kind) => setPicker({ type: 'reference', kind })}
                onDropAsset={addReferenceAsset}
                onRemove={removeReferenceItem}
                onMove={moveReferenceItem}
                onReorder={reorderReferenceItem}
                onInsertTag={(tag) => editorRef.current?.insertText(tag)}
                onToggleAudio={toggleVideoAudio}
                onEditTrim={(index, video) => setTrimTarget({ index, video })}
                guides={guides}
                onAddGuide={() => setPicker({ type: 'guide' })}
                onRemoveGuide={removeGuide}
                onGuideSecondsChange={changeGuideSeconds}
              />
            ) : null}

            <div>
              <div className="min-w-0">
                <PromptInput
                  ref={editorRef}
                  disabled={running}
                  maxRefs={maxRefs}
                  allowAssetDrop={mode === 'image'}
                  assetDropHint={
                    videoMode === 'reference'
                      ? '素材请拖到上方的参考素材区'
                      : '图片或视频请拖到上方的首帧或尾帧槽位'
                  }
                  placeholder={
                    mode === 'image'
                      ? '描述画面，可把左侧图片拖进来'
                      : videoMode === 'keyframes'
                        ? '描述镜头、运镜与声音（对白 / 音效 / 配乐）；首尾帧可选'
                        : '描述画面与参考素材用途；可插入 <Picture N> / <Video N> / <Audio N>'
                  }
                  onChange={setValue}
                  onSubmit={() => void handleSubmit()}
                  onReject={setError}
                />
              </div>

            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
              <div
                className={segmentGroupClass}
                role="group"
                aria-label="生成类型"
              >
                <ModeButton active={mode === 'image'} onClick={() => switchMode('image')}>
                  <ImageIcon className="size-3.5" />
                  图片
                </ModeButton>
                <ModeButton active={mode === 'video'} onClick={() => switchMode('video')}>
                  <Video className="size-3.5" />
                  视频
                </ModeButton>
              </div>

              <GenerationOptions
                mode={mode}
                size={mode === 'image' ? imageSize : videoSize}
                tier={mode === 'image' ? imageTier : videoTier}
                onSizeChange={(next) =>
                  mode === 'image' ? setImageSize(next) : setVideoSize(next)
                }
                onTierChange={(next) =>
                  mode === 'image' ? setImageTier(next) : setVideoTier(next)
                }
              />

              {mode === 'image' ? (
                <Select
                  aria-label="生成数量"
                  value={String(count)}
                  options={COUNTS.map((item) => ({
                    value: String(item),
                    label: `${item} 张`,
                  }))}
                  disabled={hasRefs}
                  width={140}
                  onChange={(next) => setCount(Number(next))}
                />
              ) : (
                <>
                  <DurationSelect
                    value={duration}
                    disabled={running}
                    auto={autoDuration}
                    onChange={setDuration}
                  />
                  {usesReferences ? (
                    <ReferenceSettings
                      disabled={running}
                      quality={refQuality}
                      scheduler={refScheduler}
                      imageSize={refImageSize}
                      autoDuration={autoDuration}
                      canAutoDuration={canAutoDuration}
                      seedEnabled={seedEnabled}
                      seed={seed}
                      onQualityChange={setRefQuality}
                      onSchedulerChange={setRefScheduler}
                      onImageSizeChange={setRefImageSize}
                      onAutoDurationChange={setAutoDuration}
                      onSeedEnabledChange={setSeedEnabled}
                      onSeedChange={setSeed}
                    />
                  ) : null}
                </>
              )}

              {mode === 'image' && hasRefs ? (
                <span className="text-[11px] text-muted-foreground">
                  已引用 {value.refs.length} 张，按所选比例居中裁切
                </span>
              ) : null}
              {keyframeHint ? (
                <span className="text-[11px] text-muted-foreground">{keyframeHint}</span>
              ) : null}
              {referenceHint ? (
                <span className="text-[11px] text-muted-foreground">{referenceHint}</span>
              ) : null}
              {missingReference ? (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  至少添加 1 个参考素材
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <button
                  ref={assistantAnchorRef}
                  type="button"
                  aria-expanded={assistantOpen}
                  aria-haspopup="dialog"
                  title="提示词助手：模板、标签、格式检查与 AI 优化"
                  className={cn(
                    'relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                    assistantOpen
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => setAssistantOpen((value) => !value)}
                >
                  <Wand2 className="size-3.5" />
                  助手
                  {assistantWarnings.length > 0 ? (
                    <span
                      className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-amber-500"
                      aria-label="提示词有格式建议"
                    />
                  ) : null}
                </button>
                <Popover
                  open={assistantOpen}
                  onOpenChange={setAssistantOpen}
                  anchorRef={assistantAnchorRef}
                  width={440}
                  align="end"
                >
                  <PromptAssistant
                    mode={assistantMode}
                    videoMode={videoMode}
                    keyframes={assistantKeyframes}
                    counts={assistantCounts}
                    prompt={value.text}
                    disabled={running}
                    canOptimize={mode === 'video'}
                    optimizing={optimizing}
                    optimizeError={optimizeError}
                    onOptimize={() => void handleOptimize()}
                    onInsert={(text) => editorRef.current?.insertText(text)}
                    onInsertTemplate={(text) => editorRef.current?.insertTemplate(text)}
                  />
                </Popover>
                {running ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatClock(elapsed)}
                  </span>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="h-8 rounded-full px-4"
                  disabled={running || !value.text.trim() || missingReference}
                >
                  {running ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      生成中
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      生成
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <p className="mt-2 px-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>

      <AssetPickerDialog
        open={picker?.type === 'keyframe'}
        title={picker?.type === 'keyframe' && picker.slot === 'last' ? '选择尾帧' : '选择首帧'}
        project={project}
        episodeCode={episodeCode}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        onSelect={handlePicked}
      />

      <AssetPickerDialog
        open={picker?.type === 'reference'}
        title={pickerTitle}
        project={project}
        episodeCode={episodeCode}
        kind={pickerKind}
        multiple
        max={pickerMax}
        selectedIds={pickerItems.map((item) => item.assetId)}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        onSelectMany={(assets) => {
          if (picker?.type === 'reference') void addReferenceAssets(assets, picker.kind)
        }}
      />

      <AssetPickerDialog
        open={picker?.type === 'guide'}
        title="添加帧锚定图片"
        project={project}
        episodeCode={episodeCode}
        kind="image"
        multiple
        max={pickerMax}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        onSelectMany={(assets) => addGuides(assets)}
      />

      <VideoFrameDialog
        open={videoFrame !== null}
        video={videoFrame?.video ?? null}
        slot={videoFrame?.slot ?? 'first'}
        project={project}
        episodeCode={episodeCode}
        onOpenChange={(open) => {
          if (!open) setVideoFrame(null)
        }}
        onExtracted={handleFrameExtracted}
      />

      <VideoTrimDialog
        open={trimTarget !== null}
        video={trimTarget?.video ?? null}
        onOpenChange={(open) => {
          if (!open) setTrimTarget(null)
        }}
        onApply={(start, end) => {
          if (!trimTarget) return
          trimVideo(trimTarget.index, start, end)
          setTrimTarget(null)
        }}
      />

      <PromptOptimizeDialog
        open={optimizeOpen}
        original={optimizeOriginal}
        result={optimizeResult}
        mode="video"
        videoMode={videoMode}
        counts={assistantCounts}
        onOpenChange={(open) => {
          setOptimizeOpen(open)
          if (!open) setOptimizeResult(null)
        }}
        onApply={applyOptimized}
      />
    </aside>
  )
}

function toDragPayload(asset: Asset | null | undefined): AssetDragPayload | null {
  if (!asset?.content_url) return null
  const meta = (asset.meta ?? {}) as {
    fps?: number
    duration?: number
    has_audio?: boolean
  }
  return {
    assetId: asset.id,
    src: asset.content_url,
    name: asset.name,
    kind: asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image',
    source: asset.source,
    fps: typeof meta.fps === 'number' && meta.fps > 0 ? meta.fps : undefined,
    duration: typeof meta.duration === 'number' ? meta.duration : undefined,
    hasAudio: typeof meta.has_audio === 'boolean' ? meta.has_audio : undefined,
  }
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={segmentItemClass(active)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function VideoModeTab({
  active = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active?: boolean
  disabled?: boolean
  title?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      className={segmentItemClass(active)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

