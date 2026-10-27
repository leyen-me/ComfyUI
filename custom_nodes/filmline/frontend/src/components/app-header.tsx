import { useState, type ReactNode } from 'react'
import { Clapperboard, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

import { BRAND } from '@/lib/brand'
import { applyTheme, readTheme, type Theme } from '@/lib/theme'
import { Button } from './ui/button'

/** 品牌标记：所有页面左上角一致，点击回到项目列表。 */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="group flex shrink-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      aria-label={`${BRAND.name} 首页`}
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]">
        <Clapperboard className="size-3.5" strokeWidth={2.25} />
      </span>
      {compact ? null : (
        <span className="text-[14px] font-semibold tracking-tight">{BRAND.name}</span>
      )}
    </Link>
  )
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={next === 'light' ? '切换到浅色' : '切换到深色'}
      title={next === 'light' ? '切换到浅色' : '切换到深色'}
      onClick={() => {
        setTheme(next)
        applyTheme(next)
      }}
    >
      {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}

/**
 * 全站统一的 56px 顶栏。右侧预留任务队列按钮的位置（它是 fixed 定位的全局组件）。
 */
export function AppHeader({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  // 右侧 pr-28 给 fixed 定位的任务队列按钮留位；顶部与底部适配刘海屏 safe-area
  return (
    <header className="flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-border bg-background/80 pr-28 pl-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:gap-3 sm:pl-4">
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        <ThemeToggle />
      </div>
    </header>
  )
}
