import { Clapperboard, FolderKanban, Moon, Sun } from 'lucide-react'
import { NavLink } from 'react-router-dom'

import type { HealthInfo } from '@/lib/api'
import { BRAND } from '@/lib/brand'
import type { Theme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface AppSidebarProps {
  theme: Theme
  onToggleTheme: () => void
  health: HealthInfo | null
  healthFailed: boolean
}

export function AppSidebar({ theme, onToggleTheme, health, healthFailed }: AppSidebarProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Clapperboard className="size-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">{BRAND.name}</span>
      </div>

      <nav className="flex flex-col gap-1 px-3 pt-2" aria-label="主导航">
        <NavLink
          to="/"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          <FolderKanban className="size-4" />
          项目
        </NavLink>
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t border-border px-3 py-3">
        <div className="flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              healthFailed ? 'bg-destructive' : health ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
          {healthFailed ? '未连接' : health ? '已连接' : '连接中'}
        </div>
        <Button variant="ghost" size="sm" className="justify-start" onClick={onToggleTheme}>
          {theme === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          {theme === 'dark' ? '深色' : '浅色'}
        </Button>
      </div>
    </aside>
  )
}
