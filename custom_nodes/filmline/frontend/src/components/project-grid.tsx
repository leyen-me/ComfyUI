import type { Project } from '@/lib/api'
import { ProjectCard } from './project-card'

interface ProjectGridProps {
  projects: Project[]
  loading: boolean
  empty: boolean
  onEdit: (project: Project) => void
  onDelete: (project: Project) => void
}

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-xl border border-border bg-card p-4">
          <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-3.5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-muted" />
          <div className="mt-1.5 h-2.5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-2.5 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </>
  )
}

export function ProjectGrid({ projects, loading, empty, onEdit, onDelete }: ProjectGridProps) {
  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-20 text-center text-sm text-muted-foreground">
        还没有项目
      </div>
    )
  }

  return (
    <div className={GRID}>
      {loading && projects.length === 0 ? <SkeletonCards /> : null}
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  )
}
