import { useRef, useState } from 'react'
import { Brain, Check, ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Popover } from './ui/popover'

export interface EffortChoice {
  thinking: string
  reasoning_effort: string
}

const OPTIONS: Array<{ key: string; label: string; hint: string; choice: EffortChoice }> = [
  {
    key: 'auto',
    label: '默认',
    hint: '不发送思考参数，由 provider 决定',
    choice: { thinking: 'auto', reasoning_effort: 'high' },
  },
  {
    key: 'low',
    label: '低',
    hint: 'low · 更快、更省',
    choice: { thinking: 'enabled', reasoning_effort: 'low' },
  },
  {
    key: 'high',
    label: '高',
    hint: 'high · 默认强度',
    choice: { thinking: 'enabled', reasoning_effort: 'high' },
  },
  {
    key: 'max',
    label: '最高',
    hint: 'max · 最慢，适合复杂编排',
    choice: { thinking: 'enabled', reasoning_effort: 'max' },
  },
  {
    key: 'off',
    label: '关闭',
    hint: 'disabled · 不输出思维链',
    choice: { thinking: 'disabled', reasoning_effort: 'high' },
  },
]

function currentKey(value: EffortChoice): string {
  if (value.thinking === 'disabled') return 'off'
  if (value.thinking === 'enabled') {
    if (value.reasoning_effort === 'low') return 'low'
    if (value.reasoning_effort === 'max') return 'max'
    return 'high'
  }
  return 'auto'
}

/**
 * 输入框右下角的会话级思考强度选择。
 * 选择 auto 时不发送 thinking 字段；low/high/max 会显式开启思考。
 */
export function AgentEffortSelect({
  value,
  onChange,
  disabled,
}: {
  value: EffortChoice
  onChange: (choice: EffortChoice) => void
  disabled?: boolean
}) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const key = currentKey(value)
  const active = OPTIONS.find((item) => item.key === key) ?? OPTIONS[0]!

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="思考强度（仅对当前会话生效）"
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[10.5px] text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
          key !== 'auto' && 'border-primary/30 text-foreground',
        )}
      >
        <Brain className="size-3" />
        思考：{active.label}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={250} align="end">
        <div role="listbox" aria-label="思考强度" className="p-1">
          <p className="px-2 py-1 text-[10.5px] text-muted-foreground">仅对当前会话生效</p>
          {OPTIONS.map((option) => {
            const selected = option.key === key
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.choice)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted',
                  selected && 'bg-muted/60',
                )}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-primary',
                    selected ? 'opacity-100' : 'opacity-0',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[12px] text-foreground">{option.label}</span>
                  <span className="block text-[10.5px] leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}
