import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, Sparkles, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ApiError, api, type Asset, type Project } from '@/lib/api'
import type { AssetDragPayload } from '@/lib/asset-drag'
import type { KeyframeSlot } from '@/lib/keyframes'
import { buildPromptDoc, type RefAsset } from '@/lib/prompt'
import {
  MAX_REFERENCE_IMAGES,
  addReference,
  addReferences,
  moveReference,
  reorderReference,
  removeReference,
} from '@/lib/references'
import { emitAssetsChanged, REUSE_PROMPT, type ReusePromptDetail } from '@/lib/events'
import { cn } from '@/lib/utils'
import { formatClock } from '@/lib/format'
import { AssetPickerDialog } from './asset-picker-dialog'
import { GenerationOptions } from './generation-options'
import { KeyframeSlots } from './keyframe-slots'
import { PromptInput, type PromptInputHandle } from './prompt-input'
import type { PromptValue } from './prompt-editor'
import { ReferenceTray } from './reference-tray'
import { VideoFrameDialog } from './video-frame-dialog'
import { Button } from './ui/button'

type Mode = 'image' | 'video'
type VideoMode = 'keyframes' | 'reference'
type DraftKey = 'image' | 'keyframes' | 'reference'
type PickerState = { type: 'keyframe'; slot: KeyframeSlot } | { type: 'reference' } | null

const COUNTS = [1, 2, 3, 4]
const DURATIONS = [5, 10]
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
  const [references, setReferences] = useState<AssetDragPayload[]>([])
  const [picker, setPicker] = useState<PickerState>(null)
  const [videoFrame, setVideoFrame] = useState<{
    slot: KeyframeSlot
    video: AssetDragPayload
  } | null>(null)
  const [imageSize, setImageSize] = useState<string>('16:9')
  const [imageTier, setImageTier] = useState<string>('1k')
  const [videoSize, setVideoSize] = useState<string>('16:9')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<number | null>(null)
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
  const isReferenceMode = mode === 'video' && videoMode === 'reference'
  const missingReference = isReferenceMode && references.length === 0
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
  const referenceHint =
    isReferenceMode && references.length > 0 ? `已引用 ${references.length} 张参考图` : null

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

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

    if (next === 'video' && videoSize !== '16:9' && videoSize !== '9:16') {
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
        if (detail.size === '16:9' || detail.size === '9:16') setVideoSize(detail.size)
        if (detail.duration === 5 || detail.duration === 10) setDuration(detail.duration)

        if (targetVideoMode === 'reference') {
          const refIds = detail.refIds ?? []
          if (refIds.length === 0) {
            setReferences([])
            setError('这条视频没有可还原的参考图')
          } else {
            const loaded = await Promise.all(
              refIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
            )
            const payloads = loaded
              .map((asset) => toDragPayload(asset))
              .filter((asset): asset is AssetDragPayload => Boolean(asset))
            setReferences(payloads.slice(0, MAX_REFERENCE_IMAGES))
            if (payloads.length !== refIds.length) {
              setError('部分参考图资产已删除，已跳过')
            }
          }
        } else {
          // 新数据用显式首尾帧字段；旧视频资产只有 ref_ids（最多 1 个），按首帧还原
          const firstId = detail.firstFrameId ?? detail.refIds?.[0]
          const lastId =
            detail.lastFrameId ??
            (detail.videoMode === 'keyframes' ? detail.refIds?.[1] : undefined)
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

  function addReferenceAsset(asset: AssetDragPayload) {
    const result = addReference(references, asset)
    setReferences(result.list)
    setError(result.error ?? null)
  }

  function addReferenceAssets(assets: Asset[]) {
    const payloads = assets
      .map((asset) => toDragPayload(asset))
      .filter((asset): asset is AssetDragPayload => Boolean(asset))
    const result = addReferences(references, payloads)
    setReferences(result.list)
    setError(result.error ?? null)
    setPicker(null)
  }

  function handlePicked(asset: Asset) {
    if (picker?.type !== 'keyframe') return
    const payload = toDragPayload(asset)
    if (!payload) {
      setError('该图片缺少文件内容')
      return
    }
    setKeyframe(picker.slot, payload)
    setPicker(null)
  }

  async function handleSubmit() {
    if (running) return
    const current = editorRef.current?.getValue() ?? value
    if (!current.text.trim()) return
    if (isReferenceMode && references.length === 0) {
      setError('参考生成至少需要 1 张图片')
      return
    }

    setRunning(true)
    setError(null)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((previous) => previous + 1), 1000)

    const base = episodeCode
      ? `/projects/${project.code}/episodes/${episodeCode}/assets`
      : `/projects/${project.code}/assets`

    try {
      await api.projects.generate(
        project.code,
        mode === 'image'
          ? {
              kind: 'image',
              prompt: current.text,
              size: imageSize,
              resolution: imageTier,
              count: hasRefs ? 1 : count,
              refs: current.refs,
            }
          : videoMode === 'keyframes'
            ? {
                kind: 'video',
                mode: 'keyframes',
                prompt: current.text,
                size: videoSize,
                duration,
                first_frame_id: keyframes.first?.assetId ?? null,
                last_frame_id: keyframes.last?.assetId ?? null,
              }
            : {
                kind: 'video',
                mode: 'reference',
                prompt: current.text,
                size: videoSize,
                duration,
                refs: references.map((item) => item.assetId),
              },
        episodeCode,
      )

      // 参考素材保留下来方便连续微调，只清空提示词草稿
      draftsRef.current[draftKey()] = null
      editorRef.current?.clear()
      setValue(EMPTY_VALUE)
      emitAssetsChanged()
      navigate(`${base}/${mode}`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.fullMessage : '生成失败')
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      setRunning(false)
    }
  }

  return (
    <aside className="flex min-w-0 flex-1 flex-col border-l border-border">
      <div className="flex flex-1 items-center justify-center px-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
          className="w-full max-w-2xl"
        >
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            {mode === 'video' ? (
              <div className="flex flex-wrap items-center gap-2 px-1 pt-0.5 pb-2">
                <span className="text-[11px] text-muted-foreground">视频方式</span>
                <div
                  className="flex overflow-hidden rounded-lg border border-border"
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
                  {videoMode === 'keyframes' ? '留空即文生视频' : '参考图不锁定首帧'}
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

            {isReferenceMode ? (
              <ReferenceTray
                images={references}
                disabled={running}
                onAdd={() => setPicker({ type: 'reference' })}
                onDropAsset={addReferenceAsset}
                onRemove={(index) => setReferences((previous) => removeReference(previous, index))}
                onMove={(index, delta) =>
                  setReferences((previous) => moveReference(previous, index, delta))
                }
                onReorder={(from, to) =>
                  setReferences((previous) => reorderReference(previous, from, to))
                }
                onInsertTag={(index) => editorRef.current?.insertText(`<Picture ${index + 1}>`)}
              />
            ) : null}

            <PromptInput
              ref={editorRef}
              disabled={running}
              maxRefs={maxRefs}
              allowAssetDrop={mode === 'image'}
              assetDropHint={
                videoMode === 'reference'
                  ? '图片请拖到上方的参考素材区'
                  : '图片或视频请拖到上方的首帧或尾帧槽位'
              }
              placeholder={
                mode === 'image'
                  ? '描述画面，可把左侧图片拖进来'
                  : videoMode === 'keyframes'
                    ? '描述镜头、运镜与声音（对白 / 音效 / 配乐）；首尾帧可选'
                    : '描述画面与参考图用途；可插入 <Picture N>'
              }
              onChange={setValue}
              onSubmit={() => void handleSubmit()}
              onReject={setError}
            />

            <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
              <div
                className="flex overflow-hidden rounded-lg border border-border"
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
                tier={mode === 'image' ? imageTier : '768'}
                onSizeChange={(next) =>
                  mode === 'image' ? setImageSize(next) : setVideoSize(next)
                }
                onTierChange={setImageTier}
              />

              {mode === 'image' ? (
                <CompactSelect
                  aria-label="生成数量"
                  value={String(count)}
                  options={COUNTS.map((item) => ({ value: String(item), label: `${item} 张` }))}
                  disabled={hasRefs}
                  onChange={(next) => setCount(Number(next))}
                />
              ) : (
                <CompactSelect
                  aria-label="视频时长"
                  value={String(duration)}
                  options={DURATIONS.map((item) => ({
                    value: String(item),
                    label: `${item} 秒`,
                  }))}
                  onChange={(next) => setDuration(Number(next))}
                />
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
                  至少添加 1 张参考图
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatClock(elapsed)}
                  </span>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="rounded-lg"
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
        title="添加参考图片"
        project={project}
        episodeCode={episodeCode}
        multiple
        max={MAX_REFERENCE_IMAGES - references.length}
        selectedIds={references.map((item) => item.assetId)}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        onSelectMany={addReferenceAssets}
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
    </aside>
  )
}

function toDragPayload(asset: Asset | null | undefined): AssetDragPayload | null {
  if (!asset?.content_url) return null
  const meta = (asset.meta ?? {}) as { fps?: number }
  return {
    assetId: asset.id,
    src: asset.content_url,
    name: asset.name,
    kind: asset.kind === 'video' ? 'video' : asset.kind === 'audio' ? 'audio' : 'image',
    source: asset.source,
    fps: typeof meta.fps === 'number' && meta.fps > 0 ? meta.fps : undefined,
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
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
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
      className={cn(
        'cursor-pointer px-2.5 py-1 text-xs transition-colors',
        active ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
        !disabled && 'hover:bg-muted hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-45',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function CompactSelect({
  value,
  options,
  onChange,
  ...props
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
} & { 'aria-label': string; disabled?: boolean }) {
  return (
    <select
      {...props}
      value={value}
      className="h-7 cursor-pointer rounded-lg border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
