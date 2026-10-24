import { useRef, useState, type DragEvent } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, TextQuote, X } from 'lucide-react'

import { hasAssetDrag, readAssetDrag, type AssetDragPayload } from '@/lib/asset-drag'
import { MAX_REFERENCE_IMAGES } from '@/lib/references'
import { cn } from '@/lib/utils'

const REF_INDEX_MIME = 'application/x-filmline-ref-index'

interface ReferenceTrayProps {
  images: AssetDragPayload[]
  disabled?: boolean
  onAdd: () => void
  onDropAsset: (asset: AssetDragPayload) => void
  onRemove: (index: number) => void
  onMove: (index: number, delta: -1 | 1) => void
  onReorder: (from: number, to: number) => void
  onInsertTag: (index: number) => void
}

/**
 * Ref2VA 参考图托盘：顺序即提示词里的 <Picture N>。
 * 参考图不是首帧，不会锁定第 0 帧；视频/音频参考后续再扩展分组。
 */
export function ReferenceTray({
  images,
  disabled = false,
  onAdd,
  onDropAsset,
  onRemove,
  onMove,
  onReorder,
  onInsertTag,
}: ReferenceTrayProps) {
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const full = images.length >= MAX_REFERENCE_IMAGES

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
          图片 {images.length}/{MAX_REFERENCE_IMAGES}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          编号对应提示词里的 &lt;Picture N&gt;
        </span>
      </div>

      <div
        className={cn(
          'flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-border bg-input/30 p-2 transition-colors',
          dragging && 'border-primary bg-primary/10',
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {images.map((asset, index) => (
          <ReferenceCard
            key={asset.assetId}
            asset={asset}
            index={index}
            count={images.length}
            disabled={disabled}
            onRemove={onRemove}
            onMove={onMove}
            onReorder={onReorder}
            onInsertTag={onInsertTag}
          />
        ))}

        {!full ? (
          <button
            type="button"
            data-reference-add
            disabled={disabled}
            className="flex aspect-video w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onAdd}
          >
            <ImagePlus className="size-3.5" />
            <span className="text-[10px]">添加图片</span>
          </button>
        ) : (
          <div className="flex aspect-video w-24 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 px-1 text-center text-[10px] text-muted-foreground">
            已达 {MAX_REFERENCE_IMAGES} 张上限
          </div>
        )}
      </div>

      <p className="mt-1.5 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
        参考图不会锁定首帧；调整顺序或删除后，请检查提示词里的编号。
      </p>
    </div>
  )
}

function ReferenceCard({
  asset,
  index,
  count,
  disabled,
  onRemove,
  onMove,
  onReorder,
  onInsertTag,
}: {
  asset: AssetDragPayload
  index: number
  count: number
  disabled: boolean
  onRemove: (index: number) => void
  onMove: (index: number, delta: -1 | 1) => void
  onReorder: (from: number, to: number) => void
  onInsertTag: (index: number) => void
}) {
  const [over, setOver] = useState(false)

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (disabled) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(REF_INDEX_MIME, String(index))
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
    const from = Number(raw)
    if (Number.isInteger(from)) onReorder(from, index)
  }

  return (
    <div
      data-reference-item={index}
      draggable={!disabled}
      title={asset.name}
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
        <img
          src={asset.src}
          alt={asset.name}
          draggable={false}
          className="size-full object-cover"
        />
        <span className="absolute top-1 left-1 rounded bg-background/85 px-1 py-0.5 font-mono text-[9px] font-medium">
          图{index + 1}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={`移除参考图 ${index + 1}`}
          className="absolute top-0.5 right-0.5 cursor-pointer rounded bg-background/85 p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:outline-none disabled:opacity-40"
          onClick={() => onRemove(index)}
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="flex items-center justify-between px-0.5 py-0.5">
        <button
          type="button"
          disabled={disabled || index === 0}
          aria-label={`前移参考图 ${index + 1}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => onMove(index, -1)}
        >
          <ChevronLeft className="size-3" />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={`插入 Picture ${index + 1} 引用`}
          title={`插入 <Picture ${index + 1}>`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-30"
          onClick={() => onInsertTag(index)}
        >
          <TextQuote className="size-3" />
        </button>
        <button
          type="button"
          disabled={disabled || index === count - 1}
          aria-label={`后移参考图 ${index + 1}`}
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => onMove(index, 1)}
        >
          <ChevronRight className="size-3" />
        </button>
      </div>
    </div>
  )
}
