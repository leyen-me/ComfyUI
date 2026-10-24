import { NavLink } from 'react-router-dom'

import type { AssetCounts, AssetKind } from '@/lib/api'
import { ASSET_KINDS } from '@/lib/asset-kinds'
import { cn } from '@/lib/utils'

interface KindTabsProps {
  /** 例如 /projects/PRJ-0001/assets 或 /projects/PRJ-0001/episodes/EP01/assets */
  basePath: string
  counts: AssetCounts
}

export function KindTabs({ basePath, counts }: KindTabsProps) {
  return (
    <nav className="flex gap-0.5 border-b border-border px-2 py-1.5" aria-label="资产分类">
      {ASSET_KINDS.map((kind) => {
        const Icon = kind.icon
        return (
          <NavLink
            key={kind.value}
            to={`${basePath}/${kind.value}`}
            className={({ isActive }) =>
              cn(
                'flex flex-1 items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] transition-colors',
                isActive
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <Icon className="size-3.5 shrink-0" />
            {kind.label}
            <span className="font-mono text-[10px] opacity-70">{counts[kind.value]}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export function isAssetKind(value: string | undefined): value is AssetKind {
  return ASSET_KINDS.some((item) => item.value === value)
}
