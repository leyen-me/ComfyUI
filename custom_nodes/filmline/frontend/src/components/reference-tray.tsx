import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileAudio,
  Film,
  ImagePlus,
  Music,
  TextQuote,
  X,
} from 'lucide-react'

import { hasAssetDrag, readAssetDrag, type AssetDragPayload } from '@/lib/asset-drag'
import {
  MAX_REFERENCE_AUDIOS,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_VIDEOS,
  referenceDurationWarning,
  soundtrackOrdinal,
  standaloneAudioOrdinal,
  totalReferences,
  type ReferenceAudio,
  type ReferenceLists,
  type ReferenceVideo,
} from '@/lib/references'
import { cn } from '@/lib/utils'

const REF_INDEX_MIME = 'application/x-filmline-ref-index'
type ReferenceKind = 'image' | 'video' | 'audio'

interface RefDrag {
  kind: ReferenceKind
  index: number
}

interface ReferenceTrayProps {
  lists: ReferenceLists
  disabled?: boolean
  onAdd: (kind: ReferenceKind) => void
  onDropAsset: (asset: AssetDragPayload) => void
  onRemove: (kind: ReferenceKind, index: number) => void
  onMove: (kind: ReferenceKind, index: number, delta: -1 | 1) => void
  onReorder: (kind: ReferenceKind, from: number, to: number) => void
  onInsertTag: (tag: string) => void
  onToggleAudio: (index: number) => void
}

/**
 * Ref2VA 参考素材托盘：图片 / 视频 / 音频各自编号。
 * 视频原声占用 <Audio j>，排在所有独立音频之前；参考素材都不锁定第 0 帧。
 */
export function ReferenceTray({
  lists,
  disabled = false,
  onAdd,
  onDropAsset,
  onRemove,
  onMove,
  onReorder,
  onInsertTag,
  onToggleAudio,
}: ReferenceTrayProps) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const total = totalReferences(lists)
  const atLimit = total >= MAX_REFERENCE_FILES
  const videoTotal = lists.videos.reduce((sum, item) => sum + (item.duration ?? 0), 0)
  const audioTotal = lists.audios.reduce((sum, item) => sum + (item.duration ?? 0), 0)
  const durationWarning =
    [...lists.videos, ...lists.audios].some((item) =>
      referenceDurationWarning(item.duration),
    ) ||
    videoTotal > 15.05 ||
    audioTotal > 15.05

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (hasAssetDrag(event.dataTransfer)) setDragging(true)
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (disabled) return
    dragDepth.current += 1
    if (hasAssetDrag(event.dataTransfer)) setDragging(true)
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (disabled) return
    const payload = readAssetDrag(event.dataTransfer)
    if (payload) onDropAsset(payload)
  }

  return (
    <div data-reference-tray className="px-1 pb-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-medium text-foreground">参考素材</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          图片 {lists.images.length}/{MAX_REFERENCE_IMAGES}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          视频 {lists.videos.length}/{MAX_REFERENCE_VIDEOS}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          音频 {lists.audios.length}/{MAX_REFERENCE_AUDIOS}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          合计 {total}/{MAX_REFERENCE_FILES}
        </span>
      </div>

      <div
        data-reference-drop
        className={cn(
          'space-y-2 rounded-lg border border-dashed border-border bg-input/30 p-2 transition-colors',
          dragging && 'border-primary bg-primary/10',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Section
          label="图片"
          count={lists.images.length}
          limit={MAX_REFERENCE_IMAGES}
          disabled={disabled || atLimit || lists.images.length >= MAX_REFERENCE_IMAGES}
          addLabel="添加参考图片"
          onAdd={() => onAdd('image')}
        >
          {lists.images.map((asset, index) => (
            <CardShell
              key={asset.assetId}
              kind="image"
              index={index}
              count={lists.images.length}
              disabled={disabled}
              badge={`图${index + 1}`}
              title={asset.name}
              insertLabel={`插入 Picture ${index + 1} 引用`}
              onInsert={() => onInsertTag(`<Picture ${index + 1}>`)}
              onRemove={onRemove}
              onMove={onMove}
              onReorder={onReorder}
            >
              <img
                src={asset.src}
                alt={asset.name}
                draggable={false}
                className="size-full object-cover"
              />
            </CardShell>
          ))}
        </Section>

        <Section
          label="视频"
          count={lists.videos.length}
          limit={MAX_REFERENCE_VIDEOS}
          disabled={disabled || atLimit || lists.videos.length >= MAX_REFERENCE_VIDEOS}
          addLabel="添加参考视频"
          onAdd={() => onAdd('video')}
        >
          {lists.videos.map((asset, index) => (
            <VideoCard
              key={asset.assetId}
              asset={asset}
              index={index}
              videos={lists.videos}
              disabled={disabled}
              onToggleAudio={onToggleAudio}
              onInsertTag={onInsertTag}
              onRemove={onRemove}
              onMove={onMove}
              onReorder={onReorder}
            />
          ))}
        </Section>

        <Section
          label="音频"
          count={lists.audios.length}
          limit={MAX_REFERENCE_AUDIOS}
          disabled={disabled || atLimit || lists.audios.length >= MAX_REFERENCE_AUDIOS}
          addLabel="添加参考音频"
          onAdd={() => onAdd('audio')}
        >
          {lists.audios.map((asset, index) => (
            <AudioCard
              key={asset.assetId}
              asset={asset}
              index={index}
              count={lists.audios.length}
              ordinal={standaloneAudioOrdinal(lists.videos, lists.audios, index)}
              disabled={disabled}
              onInsertTag={onInsertTag}
              onRemove={onRemove}
              onMove={onMove}
              onReorder={onReorder}
            />
          ))}
        </Section>
      </div>

      <p className="mt-1.5 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
        参考素材不锁定首帧。视频原声会占用一个 &lt;Audio j&gt; 编号，独立音频排在所有原声之后。
      </p>
      {durationWarning ? (
        <p className="mt-0.5 px-0.5 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          有素材时长不在 2–15 秒，或视频/音频总时长超过 15 秒；生成时会被拒绝。
        </p>
      ) : null}
    </div>
  )
}

function Section({
  label,
  count,
  limit,
  disabled,
  addLabel,
  onAdd,
  children,
}: {
  label: string
  count: number
  limit: number
  disabled: boolean
  addLabel: string
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
        <span className="font-mono text-[9px] text-muted-foreground/80">
          {count}/{limit}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {children}
        <button
          type="button"
          disabled={disabled}
          aria-label={addLabel}
          title={addLabel}
          className="flex aspect-video w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onAdd}
        >
          {label === '图片' ? (
            <ImagePlus className="size-3.5" />
          ) : label === '视频' ? (
            <Film className="size-3.5" />
          ) : (
            <Music className="size-3.5" />
          )}
          <span className="text-[10px]">添加</span>
        </button>
      </div>
    </div>
  )
}

function CardShell({
  kind,
  index,
  count,
  disabled,
  badge,
  title,
  insertLabel,
  onInsert,
  onRemove,
  onMove,
  onReorder,
  children,
  footer,
  extraAction,
}: {
  kind: ReferenceKind
  index: number
  count: number
  disabled: boolean
  badge: string
  title: string
  insertLabel: string
  onInsert: () => void
  onRemove: (kind: ReferenceKind, index: number) => void
  onMove: (kind: ReferenceKind, index: number, delta: -1 | 1) => void
  onReorder: (kind: ReferenceKind, from: number, to: number) => void
  children: ReactNode
  footer?: ReactNode
  extraAction?: ReactNode
}) {
  const [over, setOver] = useState(false)

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (disabled) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(REF_INDEX_MIME, JSON.stringify({ kind, index }))
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled) return
    if (!Array.from(event.dataTransfer.types).includes(REF_INDEX_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    setOver(true)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled) return
    if (!Array.from(event.dataTransfer.types).includes(REF_INDEX_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    setOver(false)
    const raw = event.dataTransfer.getData(REF_INDEX_MIME)
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as RefDrag
      if (payload.kind === kind && Number.isInteger(payload.index)) {
        onReorder(kind, payload.index, index)
      }
    } catch {
      /* 无效拖拽载荷直接忽略 */
    }
  }

  return (
    <div
      data-reference-item={`${kind}-${index}`}
      draggable={!disabled}
      title={title}
      className={cn(
        'group relative w-24 shrink-0 cursor-grab overflow-hidden rounded-lg border border-border bg-card active:cursor-grabbing',
        over && 'border-primary ring-2 ring-primary/30',
      )}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <div className="relative aspect-video bg-muted">
        {children}
        <span className="absolute top-1 left-1 rounded bg-background/85 px-1 py-0.5 font-mono text-[9px] font-medium">
          {badge}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={`移除参考${badge}`}
          className="absolute top-0.5 right-0.5 cursor-pointer rounded bg-background/85 p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none disabled:opacity-40"
          onClick={() => onRemove(kind, index)}
        >
          <X className="size-3" />
        </button>
      </div>

      {footer ? <div className="px-1 py-0.5">{footer}</div> : null}

      <div className="flex items-center justify-between px-0.5 pb-0.5">
        <button
          type="button"
          disabled={disabled || index === 0}
          aria-label={`前移参考${badge}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => onMove(kind, index, -1)}
        >
          <ChevronLeft className="size-3" />
        </button>
        {extraAction}
        <button
          type="button"
          disabled={disabled}
          aria-label={insertLabel}
          title={insertLabel}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-30"
          onClick={onInsert}
        >
          <TextQuote className="size-3" />
        </button>
        <button
          type="button"
          disabled={disabled || index === count - 1}
          aria-label={`后移参考${badge}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => onMove(kind, index, 1)}
        >
          <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  )
}

function VideoCard({
  asset,
  index,
  videos,
  disabled,
  onToggleAudio,
  onInsertTag,
  onRemove,
  onMove,
  onReorder,
}: {
  asset: ReferenceVideo
  index: number
  videos: ReferenceVideo[]
  disabled: boolean
  onToggleAudio: (index: number) => void
  onInsertTag: (tag: string) => void
  onRemove: (kind: ReferenceKind, index: number) => void
  onMove: (kind: ReferenceKind, index: number, delta: -1 | 1) => void
  onReorder: (kind: ReferenceKind, from: number, to: number) => void
}) {
  const audioOrdinal = soundtrackOrdinal(videos, index)
  const warning = referenceDurationWarning(asset.duration)

  return (
    <CardShell
      kind="video"
      index={index}
      count={videos.length}
      disabled={disabled}
      badge={`视频${index + 1}`}
      title={asset.name}
      insertLabel={`插入 Video ${index + 1} 引用`}
      onInsert={() => onInsertTag(`<Video ${index + 1}>`)}
      onRemove={onRemove}
      onMove={onMove}
      onReorder={onReorder}
      footer={
        <div className="flex items-center justify-between gap-1">
          <label
            className="flex cursor-pointer items-center gap-1 text-[9px] text-muted-foreground"
            title={asset.hasAudio ? '原声会占用一个音频编号' : '该视频没有音轨'}
          >
            <input
              type="checkbox"
              className="size-2.5 accent-primary"
              checked={asset.useAudio}
              disabled={disabled || !asset.hasAudio}
              onChange={() => onToggleAudio(index)}
            />
            含音轨
          </label>
          <span
            className={cn(
              'font-mono text-[9px] text-muted-foreground',
              warning && 'text-amber-600 dark:text-amber-400',
            )}
            title={warning ?? undefined}
          >
            {asset.duration ? `${asset.duration.toFixed(1)}s` : '时长未知'}
          </span>
        </div>
      }
      extraAction={
        audioOrdinal ? (
          <button
            type="button"
            disabled={disabled}
            aria-label={`插入音轨 Audio ${audioOrdinal} 引用`}
            title={`插入 <Audio ${audioOrdinal}>`}
            className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-30"
            onClick={() => onInsertTag(`<Audio ${audioOrdinal}>`)}
          >
            <Music className="size-3" />
          </button>
        ) : null
      }
    >
      <Film className="absolute inset-0 m-auto size-5 text-muted-foreground/50" />
      <video
        src={asset.src}
        preload="metadata"
        muted
        playsInline
        draggable={false}
        className="relative size-full object-cover"
      />
    </CardShell>
  )
}

function AudioCard({
  asset,
  index,
  count,
  ordinal,
  disabled,
  onInsertTag,
  onRemove,
  onMove,
  onReorder,
}: {
  asset: ReferenceAudio
  index: number
  count: number
  ordinal: number
  disabled: boolean
  onInsertTag: (tag: string) => void
  onRemove: (kind: ReferenceKind, index: number) => void
  onMove: (kind: ReferenceKind, index: number, delta: -1 | 1) => void
  onReorder: (kind: ReferenceKind, from: number, to: number) => void
}) {
  const warning = referenceDurationWarning(asset.duration)
  return (
    <CardShell
      kind="audio"
      index={index}
      count={count}
      disabled={disabled}
      badge={`音频${index + 1}`}
      title={asset.name}
      insertLabel={`插入 Audio ${ordinal} 引用`}
      onInsert={() => onInsertTag(`<Audio ${ordinal}>`)}
      onRemove={onRemove}
      onMove={onMove}
      onReorder={onReorder}
      footer={
        <span
          className={cn(
            'font-mono text-[9px] text-muted-foreground',
            warning && 'text-amber-600 dark:text-amber-400',
          )}
          title={warning ?? undefined}
        >
          {asset.duration ? `${asset.duration.toFixed(1)}s` : '时长未知'}
        </span>
      }
    >
      <span className="flex size-full items-center justify-center bg-muted text-muted-foreground">
        <FileAudio className="size-5" />
      </span>
    </CardShell>
  )
}
