import { ArrowLeft, Plus } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'

import type { Episode, Project } from '@/lib/api'
import { cn } from '@/lib/utils'
import { MoreMenu } from './ui/more-menu'

interface ProjectSidebarProps {
  project: Project
  episodes: Episode[]
  onCreateEpisode: () => void
  onEditEpisode: (episode: Episode) => void
  onDeleteEpisode: (episode: Episode) => void
}

export function ProjectSidebar({
  project,
  episodes,
  onCreateEpisode,
  onEditEpisode,
  onDeleteEpisode,
}: ProjectSidebarProps) {
  const { pathname } = useLocation()
  const inAssets = pathname.includes('/assets/')
  const inEpisodes = pathname.includes('/episodes')

  const itemClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
      active
        ? 'bg-accent font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-4 pt-4 pb-2">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          全部项目
        </Link>

        <div className="mt-4 min-w-0">
          <div className="font-mono text-[11px] text-muted-foreground">{project.code}</div>
          <div className="truncate text-sm font-medium" title={project.name}>
            {project.name}
          </div>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 px-3" aria-label="项目导航">
        <Link to={`/projects/${project.code}/assets/text`} className={itemClass(inAssets)}>
          资产
        </Link>

        <Link to={`/projects/${project.code}/episodes`} className={itemClass(inEpisodes)}>
          分集
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {episodes.length}
          </span>
          <button
            type="button"
            aria-label="新建分集"
            title="新建分集"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onCreateEpisode()
            }}
          >
            <Plus className="size-3.5" />
          </button>
        </Link>

        <div className="mt-1 min-h-0 flex-1 overflow-y-auto pb-3">
          {episodes.map((episode) => {
            const active = pathname.startsWith(
              `/projects/${project.code}/episodes/${episode.code}`,
            )
            return (
              <div
                key={episode.id}
                className={cn(
                  'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                  active ? 'bg-accent' : 'hover:bg-muted',
                )}
              >
                <Link
                  to={`/projects/${project.code}/episodes/${episode.code}/assets/text`}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pl-7 text-xs',
                    active ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span className="font-mono text-[10px] opacity-70">{episode.code}</span>
                  <span className="truncate">{episode.title}</span>
                </Link>
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
            )
          })}
        </div>
      </nav>
    </aside>
  )
}
