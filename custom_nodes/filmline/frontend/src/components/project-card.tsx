import type { DragEvent } from 'react'

import type { Project } from '@/lib/api'
import { formatTime } from '@/lib/format'
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

export function ProjectCard({ project, dragging, actions, onOpen, drag }: ProjectCardProps) {
  return (
    <article
      draggable
      onDragStart={drag.onDragStart}
      onDragEnter={drag.onDragEnter}
      onDragOver={drag.onDragOver}
      onDragEnd={drag.onDragEnd}
      className={cn(
        'group relative flex cursor-grab flex-col rounded-xl border border-border bg-card transition-colors active:cursor-grabbing',
        dragging ? 'opacity-40' : 'hover:border-primary/35 hover:bg-muted/25',
      )}
    >
      <div className="flex flex-col gap-2 p-4 pb-2">
        <span className="font-mono text-[11px] text-muted-foreground">{project.code}</span>
        <h3 className="line-clamp-2 text-sm font-medium">{project.name}</h3>
        {project.description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        ) : null}
      </div>

      {/* 覆盖整卡的打开按钮，位于内容之下、操作栏之下 */}
      <button
        type="button"
        aria-label={`打开 ${project.name}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        onClick={onOpen}
      />

      <div className="relative z-10 mt-auto flex items-center justify-between gap-2 px-4 pb-3">
        <span className="font-mono text-[11px] text-muted-foreground/80">
          {formatTime(project.updated_at)}
        </span>
        <MoreMenu actions={actions} label={`${project.name} 的操作`} />
      </div>
    </article>
  )
}
