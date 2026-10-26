import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from './button'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * 基于原生 <dialog> 的模态框：自带焦点陷阱、Esc 关闭、顶层渲染，
 * 不引入 Radix 之类的额外依赖。
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={cn(
        'w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-border bg-elevated p-0 text-foreground shadow-[var(--shadow-pop)]',
        className,
      )}
      onCancel={(event) => {
        event.preventDefault()
        onOpenChange(false)
      }}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        // 点遮罩关闭：点击落在 dialog 元素本身（而非内容容器）即视为遮罩
        if (event.target === ref.current) onOpenChange(false)
      }}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={() => onOpenChange(false)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="px-6 pb-2">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-border bg-muted/40 px-6 py-3.5">{footer}</div>
      ) : null}
    </dialog>
  )
}
