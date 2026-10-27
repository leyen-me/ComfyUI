import type { DragEvent } from 'react'
import { Maximize2 } from 'lucide-react'

import type { Asset, AssetKind } from '@/lib/api'
import { assetDimensions, assetPrompt } from '@/lib/asset-meta'
import { setAssetDrag } from '@/lib/asset-drag'
import { formatRelative, formatSize, formatTime } from '@/lib/format'
import { MoreMenu, type MenuAction } from './ui/more-menu'
import { SourceBadge } from './source-badge'
import { VideoThumb } from './video-thumb'

interface AssetListProps {
  kind: AssetKind
  assets: Asset[]
  onPreview: (asset: Asset) => void
  onEdit: (asset: Asset) => void
  onDelete: (asset: Asset) => void
  onCopyPrompt: (prompt: string) => void
  onReusePrompt: (asset: Asset) => void
}

export function startAssetDrag(event: DragEvent<HTMLElement>, asset: Asset) {
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
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_1px_rgb(0_0_0/0.04)]">
        {assets.map((asset) => (
          <article
            key={asset.id}
            draggable={Boolean(asset.text_content?.trim())}
            title="可拖到右侧提示词输入框"
            onDragStart={(event) => startAssetDrag(event, asset)}
            className="flex items-start gap-2 transition-colors hover:bg-muted focus-within:bg-muted"
          >
            <button
              type="button"
              title={`单击编辑「${asset.name}」，也可拖到右侧提示词输入框`}
              aria-label={`编辑 ${asset.name}`}
              className="min-w-0 flex-1 cursor-pointer px-3 py-3 text-left focus-visible:outline-none"
              onClick={() => onEdit(asset)}
            >
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{asset.name}</span>
                <SourceBadge source={asset.source} kind={asset.kind} />
              </span>
              {asset.text_content ? (
                <span className="mt-1 line-clamp-2 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {asset.text_content}
                </span>
              ) : null}
              <AssetDimensions asset={asset} />
              <span className="mt-1 block font-mono text-[11px] text-muted-foreground/70">
                {formatTime(asset.created_at)}
              </span>
            </button>
            <div className="py-3 pr-2">
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
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
    <div className="grid grid-cols-2 gap-2.5">
      {assets.map((asset) => (
        <article
          key={asset.id}
          draggable
          title="可拖到右侧首帧/尾帧或参考素材区"
          onDragStart={(event) => startAssetDrag(event, asset)}
          className="group cursor-grab overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[var(--shadow-soft)] active:cursor-grabbing"
        >
          <div className="relative aspect-video bg-muted">
            <button
              type="button"
              className="block size-full cursor-zoom-in overflow-hidden focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
              aria-label={`查看 ${asset.name}`}
              onClick={() => onPreview(asset)}
            >
              {kind === 'image' ? (
                <img
                  src={asset.content_url ?? ''}
                  alt={asset.name}
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                />
              ) : (
                <VideoThumb src={asset.content_url ?? ''} className="size-full" />
              )}
            </button>

            <div className="absolute top-1.5 left-1.5">
              <SourceBadge source={asset.source} kind={asset.kind} />
            </div>
            {/* 触屏没有 hover，操作菜单在手机上常显；桌面仍保持悬停出现 */}
            <div className="absolute top-1.5 right-1.5 rounded-md bg-background/70 opacity-100 backdrop-blur-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100">
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
          </div>

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
                <span title={formatTime(asset.created_at)}>
                  {formatRelative(asset.created_at)}
                </span>
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
