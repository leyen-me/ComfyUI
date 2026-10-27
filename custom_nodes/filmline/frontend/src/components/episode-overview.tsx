import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { Episode } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { Button } from './ui/button'
import { MoreMenu } from './ui/more-menu'

interface EpisodeOverviewProps {
  episodes: Episode[]
  basePath: string
  loading: boolean
  onCreate: () => void
  onEdit: (episode: Episode) => void
  onDelete: (episode: Episode) => void
}

export function EpisodeOverview({
  episodes,
  basePath,
  loading,
  onCreate,
  onEdit,
  onDelete,
}: EpisodeOverviewProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">分集</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{episodes.length}</span>
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={onCreate}>
            <Plus className="size-3.5" />
            新建
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && episodes.length === 0 ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : null}

        {!loading && episodes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-16 text-center text-xs text-muted-foreground">
            还没有分集
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {episodes.map((episode) => (
            <article
              key={episode.id}
              className="group relative rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/35 hover:bg-muted/25"
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {episode.code}
                    </span>
                    <h3 className="truncate text-sm font-medium">{episode.title}</h3>
                  </div>
                  {episode.synopsis ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                      {episode.synopsis}
                    </p>
                  ) : null}
                  <div className="mt-1.5 font-mono text-[11px] text-muted-foreground/70">
                    {formatTime(episode.updated_at)}
                  </div>
                </div>
                <MoreMenu
                  label={`${episode.code} 的操作`}
                  actions={[
                    { label: '编辑', onSelect: () => onEdit(episode) },
                    {
                      label: '删除',
                      destructive: true,
                      onSelect: () => onDelete(episode),
                    },
                  ]}
                />
              </div>

              <Link
                to={`${basePath}/episodes/${episode.code}/assets/text`}
                aria-label={`打开 ${episode.code} ${episode.title}`}
                className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              />
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
