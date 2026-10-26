import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ArrowLeftRight, ImagePlus, X } from 'lucide-react'

import { hasAssetDrag, readAssetDrag, type AssetDragPayload } from '@/lib/asset-drag'
import { ratioWarning, type KeyframeSlot, type VideoRatio } from '@/lib/keyframes'
import { cn } from '@/lib/utils'

interface KeyframeSlotsProps {
  first: AssetDragPayload | null
  last: AssetDragPayload | null
  size: string
  disabled?: boolean
  hint?: string
  onPick: (slot: KeyframeSlot) => void
  onClear: (slot: KeyframeSlot) => void
  onDropAsset: (slot: KeyframeSlot, asset: AssetDragPayload) => void
  onSwap: () => void
  onUseRatio: (size: VideoRatio) => void
}

/**
 * 首尾帧专用输入区：与提示词编辑器的图片块分离，避免“这张图是首帧还是参考”的歧义。
 * 两个槽位都留空即文生视频；只填一个就是首帧或尾帧生视频（由槽位决定，不靠提示词猜）。
 */
export function KeyframeSlots({
  first,
  last,
  size,
  disabled = false,
  hint,
  onPick,
  onClear,
  onDropAsset,
  onSwap,
  onUseRatio,
}: KeyframeSlotsProps) {
  return (
    <div className="px-1 pb-2">
      <div className="flex items-stretch gap-2">
        <FrameSlot
          slot="first"
          asset={first}
          targetSize={size}
          disabled={disabled}
          onPick={onPick}
          onClear={onClear}
          onDropAsset={onDropAsset}
          onUseRatio={onUseRatio}
        />

        <div className="flex w-6 shrink-0 items-center justify-center">
          {first && last ? (
            <button
              type="button"
              disabled={disabled}
              aria-label="交换首尾帧"
              title="交换首尾帧"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
              onClick={onSwap}
            >
              <ArrowLeftRight className="size-3.5" />
            </button>
          ) : (
            <span aria-hidden className="text-xs text-muted-foreground/50">
              →
            </span>
          )}
        </div>

        <FrameSlot
          slot="last"
          asset={last}
          targetSize={size}
          disabled={disabled}
          onPick={onPick}
          onClear={onClear}
          onDropAsset={onDropAsset}
          onUseRatio={onUseRatio}
        />
      </div>

      <p className="mt-1.5 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
        {hint ??
          '两个都留空为文生视频；只填一个就是首帧或尾帧。图片会按所选比例居中裁切；把视频拖进来可以挑其中一帧。'}
      </p>
    </div>
  )
}

function FrameSlot({
  slot,
  asset,
  targetSize,
  disabled,
  onPick,
  onClear,
  onDropAsset,
  onUseRatio,
}: {
  slot: KeyframeSlot
  asset: AssetDragPayload | null
  targetSize: string
  disabled: boolean
  onPick: (slot: KeyframeSlot) => void
  onClear: (slot: KeyframeSlot) => void
  onDropAsset: (slot: KeyframeSlot, asset: AssetDragPayload) => void
  onUseRatio: (size: VideoRatio) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const dragDepth = useRef(0)

  // 换图后重新测量，避免沿用上一张图的警告
  useEffect(() => setNatural(null), [asset?.assetId])

  const label = slot === 'first' ? '首帧' : '尾帧'
  const warning = natural ? ratioWarning(natural.width, natural.height, targetSize) : null

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled) return
    // 某些浏览器在 dragover 阶段不暴露自定义 MIME，必须无条件 preventDefault 才能收到 drop
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
    if (payload) onDropAsset(slot, payload)
  }

  return (
    <div className="min-w-0 flex-1">
      <div
        data-keyframe-slot={slot}
        className={cn(
          'relative aspect-video overflow-hidden rounded-lg border border-dashed border-border bg-input/40 transition-colors',
          asset && 'border-solid',
          dragging && 'border-primary bg-primary/10',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {asset ? (
          <>
            <img
              src={asset.src}
              alt={asset.name}
              draggable={false}
              className="size-full object-cover"
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/10" />
            <span className="pointer-events-none absolute top-1 left-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              {label}
            </span>
            <button
              type="button"
              disabled={disabled}
              className="absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70 focus-visible:outline-none"
              aria-label={`更换${label}：${asset.name}`}
              onClick={() => onPick(slot)}
            />
            <button
              type="button"
              disabled={disabled}
              className="absolute top-1 right-1 cursor-pointer rounded bg-background/85 p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none disabled:opacity-40"
              aria-label={`清除${label}`}
              onClick={() => onClear(slot)}
            >
              <X className="size-3" />
            </button>
            <span className="pointer-events-none absolute inset-x-1 bottom-1 truncate text-[10px] text-white/90">
              {asset.name}
            </span>
          </>
        ) : (
          <button
            type="button"
            disabled={disabled}
            className="flex size-full cursor-pointer flex-col items-center justify-center gap-1 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => onPick(slot)}
          >
            <ImagePlus className="size-4" />
            <span className="text-[11px] font-medium">{label}</span>
            <span className="text-[10px] opacity-70">拖入图片/视频，或点击选图</span>
          </button>
        )}
      </div>

      {warning ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
          <span>
            {label}为 {warning.label}，与输出 {targetSize} 不一致，将居中裁切
          </span>
          {warning.suggested ? (
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2 hover:no-underline"
              onClick={() => onUseRatio(warning.suggested as VideoRatio)}
            >
              改用 {warning.suggested}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
