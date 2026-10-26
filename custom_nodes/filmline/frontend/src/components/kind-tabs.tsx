import { NavLink } from 'react-router-dom'

import type { AssetCounts, AssetKind } from '@/lib/api'
import { ASSET_KINDS } from '@/lib/asset-kinds'
import { cn } from '@/lib/utils'
import { segmentGroupClass, segmentItemClass } from './ui/segmented'

interface KindTabsProps {
  /** 例如 /projects/PRJ-0001/assets 或 /projects/PRJ-0001/episodes/EP01/assets */
  basePath: string
  counts: AssetCounts
}

export function KindTabs({ basePath, counts }: KindTabsProps) {
  return (
    <nav
      className={cn(segmentGroupClass, 'mx-3')}
      aria-label="资产分类"
    >
      {ASSET_KINDS.map((kind) => {
        const Icon = kind.icon
        return (
          <NavLink
            key={kind.value}
            to={`${basePath}/${kind.value}`}
            className={({ isActive }) =>
              segmentItemClass(isActive, 'h-7 flex-1 px-1')
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
