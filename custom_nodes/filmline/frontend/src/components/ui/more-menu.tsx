import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { createPortal } from 'react-dom'

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

const PANEL_WIDTH = 128
const GAP = 4
const EDGE = 8

/**
 * 「三个点」操作菜单。
 *
 * 面板通过 portal 挂到 body 上、用 fixed 定位，因此不会被列表的
 * overflow 裁掉——早先的版本向上弹出，第一项的上方正好是滚动容器边界，
 * 菜单项会被直接截断。现在按可视空间自动决定向上还是向下。
 */
export function MoreMenu({ actions, label = '更多操作' }: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const button = rootRef.current?.querySelector('button')
    const panel = panelRef.current
    if (!button || !panel) return

    const rect = button.getBoundingClientRect()
    const height = Math.min(panel.offsetHeight, window.innerHeight - EDGE * 2)

    let top = rect.bottom + GAP
    if (top + height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, rect.top - GAP - height)
    }

    const left = Math.min(
      Math.max(EDGE, rect.right - PANEL_WIDTH),
      window.innerWidth - PANEL_WIDTH - EDGE,
    )

    setPosition({ top, left })
  }, [open])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    function close() {
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 滚动或缩放后 fixed 定位会脱离锚点，直接收起更可预期
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
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

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              style={{
                position: 'fixed',
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                width: PANEL_WIDTH,
                maxHeight: window.innerHeight - EDGE * 2,
                overflowY: 'auto',
                visibility: position ? 'visible' : 'hidden',
              }}
              className="animate-rise z-50 rounded-xl border border-border bg-elevated p-1 shadow-[var(--shadow-pop)]"
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  className={cn(
                    'flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40',
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
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
