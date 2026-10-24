import { Trash2 } from 'lucide-react'

import type { Project } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { Button } from './ui/button'

interface ProjectCardProps {
  project: Project
  onEdit: (project: Project) => void
  onDelete: (project: Project) => void
}

export function ProjectCard({ project, onEdit, onDelete }: ProjectCardProps) {
  return (
    <article className="group relative flex flex-col rounded-xl border border-border bg-card transition-colors hover:border-primary/35 hover:bg-muted/25">
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="font-mono text-[11px] text-muted-foreground">{project.code}</span>
        <h3 className="line-clamp-2 text-sm font-medium">{project.name}</h3>
        {project.description ? (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {project.description}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pb-3">
        <span className="font-mono text-[11px] text-muted-foreground/80">
          {formatTime(project.updated_at)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
          title="删除"
          aria-label={`删除 ${project.name}`}
          onClick={() => onDelete(project)}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* 覆盖整张卡片的编辑按钮；删除按钮在其上方，互不遮挡 */}
      <button
        type="button"
        aria-label={`编辑 ${project.name}`}
        className="absolute inset-0 rounded-xl focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        onClick={() => onEdit(project)}
      />
    </article>
  )
}
