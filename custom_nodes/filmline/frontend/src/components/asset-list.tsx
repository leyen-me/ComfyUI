import type { Asset, AssetKind } from '@/lib/api'
import { formatSize, formatTime } from '@/lib/format'
import { MoreMenu } from './ui/more-menu'
import { SourceBadge } from './source-badge'

interface AssetListProps {
  kind: AssetKind
  assets: Asset[]
  onDelete: (asset: Asset) => void
}

function deleteActions(asset: Asset, onDelete: (asset: Asset) => void) {
  return [
    {
      label: '删除',
      destructive: true,
      onSelect: () => onDelete(asset),
    },
  ]
}

/** 资产列宽度有限（约 1.4 倍导航宽度），因此统一单列纵向排列。 */
export function AssetList({ kind, assets, onDelete }: AssetListProps) {
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
              <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                {formatTime(asset.created_at)}
              </div>
            </div>
            <MoreMenu actions={deleteActions(asset, onDelete)} label={`${asset.name} 的操作`} />
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
              <img
                src={asset.content_url ?? ''}
                alt={asset.name}
                loading="lazy"
                className="size-full object-cover"
              />
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
              <MoreMenu actions={deleteActions(asset, onDelete)} label={`${asset.name} 的操作`} />
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
          </div>
        </article>
      ))}
    </div>
  )
}
