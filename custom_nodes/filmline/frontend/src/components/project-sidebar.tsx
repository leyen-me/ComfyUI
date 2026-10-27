import { Clapperboard, Layers, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import type { Episode } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MoreMenu } from './ui/more-menu'

interface ProjectSidebarProps {
  episodes: Episode[]
  basePath: string
  onCreateEpisode: () => void
  onEditEpisode: (episode: Episode) => void
  onDeleteEpisode: (episode: Episode) => void
}

export function ProjectSidebar({
  episodes,
  basePath,
  onCreateEpisode,
  onEditEpisode,
  onDeleteEpisode,
}: ProjectSidebarProps) {
  const { pathname } = useLocation()
  // 按相对 basePath 的剩余路径判断，兼容 /s/:sessionId 前缀
  const tail = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname
  const parts = tail.split('/').filter(Boolean)
  const inProjectAssets = parts[0] === 'assets'
  const inEpisodeOverview = parts[0] === 'episodes' && parts.length === 1

  const itemClass = (active: boolean) =>
    cn(
      'flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors',
      active
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
    )

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border">
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 p-2.5" aria-label="项目导航">
        <Link
          to={`${basePath}/assets/text`}
          className={itemClass(inProjectAssets)}
          aria-current={inProjectAssets ? 'page' : undefined}
        >
          <Layers className="size-4 shrink-0" />
          项目资产
        </Link>
        <Link
          to={`${basePath}/episodes`}
          className={itemClass(inEpisodeOverview)}
          aria-current={inEpisodeOverview ? 'page' : undefined}
        >
          <Clapperboard className="size-4 shrink-0" />
          分集总览
          <span className="ml-auto font-mono text-[11px] tabular-nums opacity-60">
            {episodes.length}
          </span>
        </Link>

        <div className="mt-5 mb-1 flex items-center justify-between pr-1 pl-2.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
            分集
          </span>
          <button
            type="button"
            aria-label="新建分集"
            title="新建分集"
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={onCreateEpisode}
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-3">
          {episodes.length === 0 ? (
            <button
              type="button"
              onClick={onCreateEpisode}
              className="w-full cursor-pointer rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
            >
              新建第一集
            </button>
          ) : null}
          {episodes.map((episode) => {
            const active = parts[0] === 'episodes' && parts[1] === episode.code
            return (
              <div
                key={episode.id}
                className={cn(
                  'group flex h-8 items-center rounded-lg pr-0.5 transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <Link
                  to={`${basePath}/episodes/${episode.code}/assets/text`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-full min-w-0 flex-1 items-center gap-2.5 rounded-lg pl-2.5 text-[13px]',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground group-hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'w-8 shrink-0 font-mono text-[10px] tabular-nums',
                      active ? 'text-primary' : 'opacity-60',
                    )}
                  >
                    {episode.code}
                  </span>
                  <span className="truncate">{episode.title}</span>
                </Link>
                <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <MoreMenu
                    label={`${episode.code} 的操作`}
                    actions={[
                      { label: '编辑', onSelect: () => onEditEpisode(episode) },
                      {
                        label: '删除',
                        destructive: true,
                        onSelect: () => onDeleteEpisode(episode),
                      },
                    ]}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
