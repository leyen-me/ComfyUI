import { Clapperboard, Layers, Sparkles } from 'lucide-react'

import type { MobileProjectTab } from '@/lib/layout'
import { cn } from '@/lib/utils'

interface MobileProjectNavProps {
  active: MobileProjectTab
  episodeCount: number
  onSelect: (tab: MobileProjectTab) => void
}

const ITEMS = [
  { tab: 'assets', label: '资产', icon: Layers },
  { tab: 'episodes', label: '分集', icon: Clapperboard },
  { tab: 'agent', label: '助手', icon: Sparkles },
] as const

/**
 * 手机项目页底部导航。
 *
 * 桌面端三栏并排，手机宽度放不下，因此改成一次只显示一栏：
 * 资产 / 分集列表 / Agent 助手，底部标签负责切换。
 * 高度包含 safe-area，避免被 iPhone 底部手势条盖住。
 */
export function MobileProjectNav({ active, episodeCount, onSelect }: MobileProjectNavProps) {
  return (
    <nav
      aria-label="项目导航（移动端）"
      className="shrink-0 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="flex h-14 items-stretch">
        {ITEMS.map((item) => {
          const selected = active === item.tab
          const Icon = item.icon
          return (
            <button
              key={item.tab}
              type="button"
              aria-current={selected ? 'page' : undefined}
              className={cn(
                'flex min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none',
                selected ? 'font-medium text-primary' : 'text-muted-foreground',
              )}
              onClick={() => onSelect(item.tab)}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={selected ? 2.2 : 1.9} />
                {item.tab === 'episodes' && episodeCount > 0 ? (
                  <span className="absolute -top-1 -right-2 flex min-w-3.5 items-center justify-center rounded-full bg-muted px-1 font-mono text-[9px] leading-3.5 text-muted-foreground">
                    {episodeCount}
                  </span>
                ) : null}
              </span>
              {item.label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
