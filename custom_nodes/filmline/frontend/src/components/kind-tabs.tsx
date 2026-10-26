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
    <nav
      className="mx-3 flex gap-0.5 rounded-xl bg-muted/70 p-0.5"
      aria-label="资产分类"
    >
      {ASSET_KINDS.map((kind) => {
        const Icon = kind.icon
        return (
          <NavLink
            key={kind.value}
            to={`${basePath}/${kind.value}`}
            className={({ isActive }) =>
              cn(
                'flex h-7 flex-1 items-center justify-center gap-1 rounded-[10px] px-1 text-[12px] transition-all',
                isActive
                  ? 'bg-elevated font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.15)] ring-1 ring-border'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <Icon className="size-3.5 shrink-0" />
            {kind.label}
            <span className="font-mono text-[10px] tabular-nums opacity-55">{counts[kind.value]}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

export function isAssetKind(value: string | undefined): value is AssetKind {
  return ASSET_KINDS.some((item) => item.value === value)
}
