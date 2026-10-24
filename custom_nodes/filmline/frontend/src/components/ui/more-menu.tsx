import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'

export interface MenuAction {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

interface MoreMenuProps {
  actions: MenuAction[]
  label?: string
}

/**
 * 「三个点」操作菜单：向上弹出，点外部或 Esc 关闭。
 * 使用普通绝对定位而非原生 popover，避免层级与定位的差异。
 */
export function MoreMenu({ actions, label = '更多操作' }: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-muted-foreground/70 hover:text-foreground"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal className="size-4" />
      </Button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-30 mb-1 w-28 rounded-lg border border-border bg-card p-1 shadow-xl"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              className={cn(
                'flex w-full cursor-pointer items-center rounded-md px-2.5 py-1.5 text-left text-xs transition-colors disabled:pointer-events-none disabled:opacity-40',
                action.destructive
                  ? 'text-destructive hover:bg-destructive/10'
                  : 'text-foreground hover:bg-muted',
              )}
              onClick={() => {
                setOpen(false)
                action.onSelect()
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
