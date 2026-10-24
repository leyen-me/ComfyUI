import type { DragEvent } from 'react'
import { Maximize2 } from 'lucide-react'

import type { Asset, AssetKind } from '@/lib/api'
import { assetDimensions, assetPrompt } from '@/lib/asset-meta'
import { setAssetDrag } from '@/lib/asset-drag'
import { formatSize, formatTime } from '@/lib/format'
import { MoreMenu, type MenuAction } from './ui/more-menu'
import { SourceBadge } from './source-badge'

interface AssetListProps {
  kind: AssetKind
  assets: Asset[]
  onPreview: (asset: Asset) => void
  onEdit: (asset: Asset) => void
  onDelete: (asset: Asset) => void
  onCopyPrompt: (prompt: string) => void
  onReusePrompt: (asset: Asset) => void
}

function startAssetDrag(event: DragEvent<HTMLElement>, asset: Asset) {
  if (asset.kind === 'text') {
    const text = asset.text_content ?? ''
    if (!text.trim()) {
      event.preventDefault()
      return
    }
    setAssetDrag(event.dataTransfer, {
      assetId: asset.id,
      src: '',
      name: asset.name,
      kind: 'text',
      text,
      source: asset.source,
    })
    return
  }
  if (!asset.content_url) {
    event.preventDefault()
    return
  }
  const meta = (asset.meta ?? {}) as {
    fps?: number
    duration?: number
    has_audio?: boolean
  }
  setAssetDrag(event.dataTransfer, {
    assetId: asset.id,
    src: asset.content_url,
    name: asset.name,
    kind: asset.kind,
    source: asset.source,
    fps: typeof meta.fps === 'number' ? meta.fps : undefined,
    duration: typeof meta.duration === 'number' ? meta.duration : undefined,
    hasAudio: typeof meta.has_audio === 'boolean' ? meta.has_audio : undefined,
  })
}

function buildActions(
  asset: Asset,
  handlers: Pick<AssetListProps, 'onPreview' | 'onEdit' | 'onDelete' | 'onCopyPrompt' | 'onReusePrompt'>,
): MenuAction[] {
  const prompt = assetPrompt(asset)
  const actions: MenuAction[] = []

  if (asset.kind === 'image' || asset.kind === 'video') {
    actions.push({ label: '预览', onSelect: () => handlers.onPreview(asset) })
  }
  if (prompt) {
    actions.push({ label: '复制提示词', onSelect: () => handlers.onCopyPrompt(prompt) })
    actions.push({ label: '复用提示词', onSelect: () => handlers.onReusePrompt(asset) })
  }
  actions.push({ label: '编辑', onSelect: () => handlers.onEdit(asset) })
  actions.push({ label: '删除', destructive: true, onSelect: () => handlers.onDelete(asset) })
  return actions
}

/** 列表只显示尺寸摘要；完整提示词在大图预览里看。 */
function AssetDimensions({ asset }: { asset: Asset }) {
  const dimensions = assetDimensions(asset)
  if (!dimensions) return null
  return (
    <div className="mt-1 font-mono text-[10px] text-muted-foreground/80">{dimensions}</div>
  )
}

/** 资产列宽度有限（约 1.4 倍导航宽度），因此统一单列纵向排列。 */
export function AssetList({
  kind,
  assets,
  onPreview,
  onEdit,
  onDelete,
  onCopyPrompt,
  onReusePrompt,
}: AssetListProps) {
  const handlers = { onPreview, onEdit, onDelete, onCopyPrompt, onReusePrompt }

  if (kind === 'text') {
    return (
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {assets.map((asset) => (
          <article
            key={asset.id}
            draggable={Boolean(asset.text_content?.trim())}
            title="可拖到右侧提示词输入框"
            onDragStart={(event) => startAssetDrag(event, asset)}
            className="flex cursor-grab items-start gap-2 px-3 py-3 active:cursor-grabbing"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="truncate text-sm font-medium">{asset.name}</h3>
                <SourceBadge source={asset.source} kind={asset.kind} />
              </div>
              {asset.text_content ? (
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {asset.text_content}
                </p>
              ) : null}
              <AssetDimensions asset={asset} />
              <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                {formatTime(asset.created_at)}
              </div>
            </div>
            <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
          </article>
        ))}
      </div>
    )
  }

  if (kind === 'audio') {
    return (
      <div className="flex flex-col gap-3">
        {assets.map((asset) => (
          <article
            key={asset.id}
            draggable
            title="可拖到右侧参考素材区"
            onDragStart={(event) => startAssetDrag(event, asset)}
            className="cursor-grab rounded-xl border border-border bg-card p-3 active:cursor-grabbing"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="truncate text-sm font-medium">{asset.name}</h3>
                  <SourceBadge source={asset.source} kind={asset.kind} />
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <span>{formatTime(asset.created_at)}</span>
                  <span>{formatSize(asset.size_bytes)}</span>
                </div>
                <AssetDimensions asset={asset} />
              </div>
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
            <audio
              controls
              preload="metadata"
              draggable={false}
              src={asset.content_url ?? ''}
              className="mt-2 w-full"
            />
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {assets.map((asset) => (
        <article
          key={asset.id}
          draggable
          title="可拖到右侧首帧/尾帧或参考素材区"
          onDragStart={(event) => startAssetDrag(event, asset)}
          className="group cursor-grab overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/40 active:cursor-grabbing"
        >
          <div className="group/vid relative aspect-video bg-muted">
            {kind === 'image' ? (
              <button
                type="button"
                className="group/img size-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                aria-label={`放大 ${asset.name}`}
                onClick={() => onPreview(asset)}
              >
                <img
                  src={asset.content_url ?? ''}
                  alt={asset.name}
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover transition-transform duration-200 group-hover/img:scale-[1.02]"
                />
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover/img:bg-black/25 group-hover/img:opacity-100">
                  <span className="flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow">
                    <Maximize2 className="size-3" />
                    放大
                  </span>
                </span>
              </button>
            ) : (
              <>
                <video
                  src={asset.content_url ?? ''}
                  controls
                  preload="metadata"
                  draggable={false}
                  className="size-full bg-black object-contain"
                />
                <span className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center opacity-0 transition-opacity group-hover/vid:opacity-100">
                  <span className="rounded-full bg-background/85 px-2 py-1 text-[11px] text-muted-foreground shadow">
                    可拖到右侧首帧/尾帧；点信息栏预览
                  </span>
                </span>
              </>
            )}

            <div className="absolute top-1.5 left-1.5">
              <SourceBadge source={asset.source} kind={asset.kind} />
            </div>
            <div className="absolute top-1.5 right-1.5 rounded-md bg-background/70 backdrop-blur-sm">
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
          </div>

          {/* 下半部分整体可点：视频的缩略图被播放器占用，这里是统一的预览入口 */}
          <button
            type="button"
            aria-label={`预览 ${asset.name}`}
            className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => onPreview(asset)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium" title={asset.name}>
                {asset.name}
              </span>
              <span className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                <span>{formatTime(asset.created_at)}</span>
                <span>{formatSize(asset.size_bytes)}</span>
              </span>
              <AssetDimensions asset={asset} />
            </span>
            <Maximize2 className="mt-0.5 size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
          </button>
        </article>
      ))}
    </div>
  )
}
