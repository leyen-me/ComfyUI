import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Popover } from './popover'

export interface SelectOption {
  value: string
  label: string
  /** 右侧的次要说明，如「上限」「快」 */
  hint?: string
}

interface SelectProps {
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  'aria-label': string
  disabled?: boolean
  width?: number
  align?: 'start' | 'end'
  title?: string
  /** 触发器显示内容，默认用当前选项的 label */
  formatValue?: (option: SelectOption | undefined) => ReactNode
  /** 选项列表下方的扩展区（自定义输入等），参数用于关闭面板 */
  footer?: (close: () => void) => ReactNode
  onOpenChange?: (open: boolean) => void
}

/**
 * 轻量下拉选择：按钮 + portal 气泡，替代原生 select。
 * 原生 select 无法承载「自定义输入」这类内容，因此统一用它。
 */
export function Select({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  disabled = false,
  width = 200,
  align = 'start',
  title,
  formatValue,
  footer,
  onOpenChange,
}: SelectProps) {
  const [open, setOpenState] = useState(false)
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const anchorRef = useRef<HTMLButtonElement>(null)
  const current = options.find((option) => option.value === value)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground transition-colors hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          open && 'border-foreground/25 bg-muted',
        )}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {formatValue ? formatValue(current) : (current?.label ?? value)}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={width} align={align}>
        <div role="listbox" aria-label={ariaLabel} className="space-y-0.5">
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:bg-muted focus-visible:outline-none',
                  active
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint ? (
                  <span className="font-mono text-[10px] opacity-60">{option.hint}</span>
                ) : null}
                {active ? <Check className="size-3 shrink-0" /> : null}
              </button>
            )
          })}
        </div>
        {footer?.(() => setOpen(false))}
      </Popover>
    </>
  )
}
