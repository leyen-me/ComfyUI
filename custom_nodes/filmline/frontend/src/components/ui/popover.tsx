import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface PopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
}

const GAP = 6
const EDGE = 8

/**
 * 锚定气泡：portal 到 body + fixed 定位，避免被祖先的 overflow 裁切；
 * 空间不足时自动向上翻转。
 */
export function Popover({
  open,
  onOpenChange,
  anchorRef,
  children,
  width = 236,
  align = 'start',
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const panel = panelRef.current
    if (!anchor || !panel) return

    const rect = anchor.getBoundingClientRect()
    const height = panel.offsetHeight

    let top = rect.bottom + GAP
    if (top + height > window.innerHeight - EDGE) {
      top = Math.max(EDGE, rect.top - GAP - height)
    }
    const preferred = align === 'end' ? rect.right - width : rect.left
    const left = Math.min(Math.max(EDGE, preferred), window.innerWidth - width - EDGE)

    setPosition({ top, left })
  }, [open, anchorRef, width, align])

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onOpenChange(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onOpenChange(false)
    }
    function close() {
      onOpenChange(false)
    }
    // scroll 事件不冒泡，但捕获阶段会经过 window；面板内部滚动容器的滚动不能关闭面板，
    // 否则任务队列等长列表一滚就消失。仅忽略源自面板内部的滚动。
    function onScroll(event: Event) {
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      close()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [open, onOpenChange, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{
        position: 'fixed',
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width,
        visibility: position ? 'visible' : 'hidden',
      }}
      className="animate-rise z-50 rounded-xl border border-border bg-elevated p-1.5 shadow-[var(--shadow-pop)]"
    >
      {children}
    </div>,
    document.body,
  )
}
