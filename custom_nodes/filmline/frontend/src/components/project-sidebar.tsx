import { ArrowLeft } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'

import type { AssetCounts, Project } from '@/lib/api'
import { ASSET_KINDS } from '@/lib/asset-kinds'
import { cn } from '@/lib/utils'

interface ProjectSidebarProps {
  project: Project
  counts: AssetCounts
}

export function ProjectSidebar({ project, counts }: ProjectSidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="px-4 pt-4 pb-3">
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

      <nav className="flex flex-col gap-0.5 px-3" aria-label="项目导航">
        <div className="px-3 pt-2 pb-1.5 text-[11px] text-muted-foreground">资产</div>
        {ASSET_KINDS.map((kind) => {
          const Icon = kind.icon
          return (
            <NavLink
              key={kind.value}
              to={`/projects/${project.code}/assets/${kind.value}`}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="size-4" />
              {kind.label}
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {counts[kind.value]}
              </span>
            </NavLink>
          )
        })}
      </nav>
    </aside>
  )
}
