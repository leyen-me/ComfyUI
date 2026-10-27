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
  /**
   * 手机端固定为接近全屏高度。用于内容密集的编辑器、列表和媒体预览；
   * 删除确认这类短弹窗保持自适应高度即可。
   */
  mobileFullHeight?: boolean
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
  mobileFullHeight = false,
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
        // 手机上占满可用宽度，并限制在动态视口内；内容区独立滚动，底部按钮始终可见
        'max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border bg-elevated p-0 text-foreground shadow-[var(--shadow-pop)] open:flex sm:max-h-[calc(100dvh-3rem)] sm:w-[min(560px,92vw)]',
        mobileFullHeight && 'max-sm:h-[calc(100dvh-1rem)]',
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
      <div className="flex shrink-0 items-start justify-between gap-4 px-4 pt-4 pb-3 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭" onClick={() => onOpenChange(false)}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 sm:px-6">{children}</div>
      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-3.5">
          {footer}
        </div>
      ) : null}
    </dialog>
  )
}
