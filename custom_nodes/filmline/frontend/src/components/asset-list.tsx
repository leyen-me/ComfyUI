import type { Asset, AssetKind } from '@/lib/api'
import { assetDimensions, assetPrompt } from '@/lib/asset-meta'
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

/** 生成参数摘要：提示词 + 尺寸，供复用与排查。 */
function GenerationInfo({ asset }: { asset: Asset }) {
  const prompt = assetPrompt(asset)
  const dimensions = assetDimensions(asset)
  if (!prompt && !dimensions) return null

  return (
    <div className="mt-1.5 space-y-1">
      {dimensions ? (
        <div className="font-mono text-[10px] text-muted-foreground/80">{dimensions}</div>
      ) : null}
      {prompt ? (
        <p
          className="line-clamp-2 rounded-md bg-muted/60 px-2 py-1 text-[11px] leading-relaxed text-muted-foreground"
          title={prompt}
        >
          {prompt}
        </p>
      ) : null}
    </div>
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
          <article key={asset.id} className="flex items-start gap-2 px-3 py-3">
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
              <GenerationInfo asset={asset} />
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
          <article key={asset.id} className="rounded-xl border border-border bg-card p-3">
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
                <GenerationInfo asset={asset} />
              </div>
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
            <audio
              controls
              preload="metadata"
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
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="relative aspect-video bg-muted">
            {kind === 'image' ? (
              <button
                type="button"
                className="size-full cursor-zoom-in focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                aria-label={`预览 ${asset.name}`}
                onClick={() => onPreview(asset)}
              >
                <img
                  src={asset.content_url ?? ''}
                  alt={asset.name}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ) : (
              <video
                src={asset.content_url ?? ''}
                controls
                preload="metadata"
                className="size-full bg-black object-contain"
              />
            )}

            <div className="absolute top-1.5 left-1.5">
              <SourceBadge source={asset.source} kind={asset.kind} />
            </div>
            <div className="absolute top-1.5 right-1.5 rounded-md bg-background/70 backdrop-blur-sm">
              <MoreMenu actions={buildActions(asset, handlers)} label={`${asset.name} 的操作`} />
            </div>
          </div>

          <div className="px-3 py-2">
            <div className="truncate text-xs font-medium" title={asset.name}>
              {asset.name}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
              <span>{formatTime(asset.created_at)}</span>
              <span>{formatSize(asset.size_bytes)}</span>
            </div>
            <GenerationInfo asset={asset} />
          </div>
        </article>
      ))}
    </div>
  )
}
