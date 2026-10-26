import { useState, type DragEvent } from 'react'

import type { Project } from '@/lib/api'
import { formatRelative, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MoreMenu, type MenuAction } from './ui/more-menu'

export interface CardDragHandlers {
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnter: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragEnd: (event: DragEvent<HTMLElement>) => void
}

interface ProjectCardProps {
  project: Project
  dragging: boolean
  actions: MenuAction[]
  onOpen: () => void
  drag: CardDragHandlers
}

/** 无封面时的占位色：按 id 稳定取色，避免整墙同一种灰。 */
const PLACEHOLDER_HUES = [28, 200, 265, 150, 340, 45, 185]

function ProjectCover({ project }: { project: Project }) {
  const [broken, setBroken] = useState(false)
  const cover = project.cover_asset_id
  if (cover !== null && !broken) {
    return (
      <img
        src={`/studio/api/assets/${cover}/content`}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setBroken(true)}
        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
    )
  }
  const hue = PLACEHOLDER_HUES[project.id % PLACEHOLDER_HUES.length] ?? 28
  return (
    <div
      className="flex size-full items-center justify-center"
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, hsl(${hue} 70% 55% / 0.35), transparent 60%), radial-gradient(90% 80% at 100% 100%, hsl(${(hue + 40) % 360} 60% 45% / 0.25), transparent 60%), var(--muted)`,
      }}
    >
      <span className="text-4xl font-semibold tracking-tight text-foreground/70 select-none">
        {Array.from(project.name)[0] ?? '?'}
      </span>
    </div>
  )
}

export function ProjectCard({ project, dragging, actions, onOpen, drag }: ProjectCardProps) {
  return (
    <article
      draggable
      onDragStart={drag.onDragStart}
      onDragEnter={drag.onDragEnter}
      onDragOver={drag.onDragOver}
      onDragEnd={drag.onDragEnd}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[border-color,box-shadow,transform,opacity] duration-200',
        dragging
          ? 'scale-[0.98] opacity-40'
          : 'hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-[var(--shadow-soft)]',
      )}
    >
      <div className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted">
        <ProjectCover project={project} />
        <span className="absolute top-2.5 left-2.5 rounded-md bg-black/45 px-1.5 py-0.5 font-mono text-[10px] text-white/85 backdrop-blur-sm">
          {project.code}
        </span>
      </div>

      {/* 覆盖整卡的打开按钮，位于内容之下、操作栏之下 */}
      <button
        type="button"
        aria-label={`打开 ${project.name}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset"
        onClick={onOpen}
      />

      <div className="flex items-start gap-2 px-4 pt-3 pb-3.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-medium tracking-tight">{project.name}</h3>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            title={`更新于 ${formatTime(project.updated_at)}`}
          >
            {project.description || `${project.asset_count} 个资产`}
            <span className="mx-1.5 opacity-50">·</span>
            {formatRelative(project.updated_at)}
          </p>
        </div>
        <div className="relative z-10 -mr-1.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <MoreMenu actions={actions} label={`${project.name} 的操作`} />
        </div>
      </div>
    </article>
  )
}
