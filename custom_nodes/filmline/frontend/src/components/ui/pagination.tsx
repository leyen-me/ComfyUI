import { ChevronLeft, ChevronRight } from 'lucide-react'

import { pageItems } from '@/lib/pagination'
import { cn } from '@/lib/utils'
import { Button } from './button'

interface PaginationProps {
  total: number
  limit: number
  offset: number
  onOffsetChange: (offset: number) => void
  disabled?: boolean
  className?: string
}

/**
 * 分页器（偏移量驱动）。只负责渲染与回调，不关心数据来源。
 */
export function Pagination({
  total,
  limit,
  offset,
  onOffsetChange,
  disabled = false,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit))
  const current = Math.min(pageCount, Math.floor(offset / limit) + 1)
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + limit, total)

  function goTo(page: number) {
    const target = Math.min(pageCount, Math.max(1, page))
    onOffsetChange((target - 1) * limit)
  }

  return (
    <nav
      aria-label="分页"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground',
        className,
      )}
    >
      <span>{total === 0 ? '共 0 条' : `第 ${from}–${to} 条，共 ${total} 条`}</span>

      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="上一页"
            disabled={disabled || current === 1}
            onClick={() => goTo(current - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>

          {pageItems(current, pageCount).map((item, index) =>
            item === 'ellipsis' ? (
              <span key={`gap-${index}`} className="px-1.5 select-none" aria-hidden="true">
                …
              </span>
            ) : (
              <Button
                key={item}
                size="icon"
                variant={item === current ? 'secondary' : 'ghost'}
                className={cn(
                  item === current && 'border-border bg-muted font-medium text-foreground',
                )}
                aria-label={`第 ${item} 页`}
                aria-current={item === current ? 'page' : undefined}
                disabled={disabled}
                onClick={() => goTo(item)}
              >
                {item}
              </Button>
            ),
          )}

          <Button
            size="icon"
            variant="ghost"
            aria-label="下一页"
            disabled={disabled || current === pageCount}
            onClick={() => goTo(current + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </nav>
  )
}
