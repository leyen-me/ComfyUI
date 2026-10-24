import { useEffect, useState } from 'react'

import {
  DURATION_MAX_SECONDS,
  DURATION_MIN_SECONDS,
  DURATION_PRESETS,
  actualSeconds,
  isValidDuration,
  videoFrames,
} from '@/lib/duration'
import { Select, type SelectOption } from './ui/select'

interface DurationSelectProps {
  /** 秒（整数） */
  value: number
  disabled?: boolean
  onChange: (seconds: number) => void
}

/** 视频时长：预设档位 + 自定义整数秒（MiniMax H3 训练区间 5–15 秒）。 */
export function DurationSelect({ value, disabled = false, onChange }: DurationSelectProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(value))
    setError(null)
  }, [value, open])

  const seconds = [...new Set([...DURATION_PRESETS, value])].sort((a, b) => a - b)
  const options: SelectOption[] = seconds.map((item) => ({
    value: String(item),
    label: `${item} 秒`,
    hint:
      item === DURATION_MAX_SECONDS ? '上限' : DURATION_PRESETS.includes(item) ? undefined : '自定义',
  }))

  function applyDraft(close: () => void) {
    const next = Number(draft.trim())
    if (!isValidDuration(next)) {
      setError(`请输入 ${DURATION_MIN_SECONDS}–${DURATION_MAX_SECONDS} 的整数秒`)
      return
    }
    onChange(next)
    setError(null)
    close()
  }

  const frames = videoFrames(value)

  return (
    <Select
      aria-label="视频时长"
      value={String(value)}
      options={options}
      disabled={disabled}
      width={224}
      onChange={(next) => onChange(Number(next))}
      onOpenChange={setOpen}
      formatValue={() => `${value} 秒`}
      footer={(close) => (
        <div className="mt-1.5 border-t border-border pt-2">
          <div className="flex items-center gap-1.5 px-1">
            <label htmlFor="duration-custom" className="text-[11px] text-muted-foreground">
              自定义
            </label>
            <input
              id="duration-custom"
              type="number"
              inputMode="numeric"
              min={DURATION_MIN_SECONDS}
              max={DURATION_MAX_SECONDS}
              step={1}
              value={draft}
              aria-label="自定义视频时长（秒）"
              className="h-6 w-14 rounded border border-border bg-input px-1.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              onChange={(event) => {
                setDraft(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  // 面板在生成表单里，必须拦住回车，避免误触发生成
                  event.preventDefault()
                  applyDraft(close)
                }
              }}
            />
            <span className="text-[11px] text-muted-foreground">秒</span>
            <button
              type="button"
              className="ml-auto h-6 cursor-pointer rounded border border-border px-2 text-[11px] text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
              onClick={() => applyDraft(close)}
            >
              应用
            </button>
          </div>
          <p className="px-1 pt-1 font-mono text-[10px] text-muted-foreground/70">
            {frames} 帧 · 实际 {actualSeconds(value).toFixed(1)} 秒 ·{' '}
            {DURATION_MIN_SECONDS}–{DURATION_MAX_SECONDS} 秒
          </p>
          {error ? <p className="px-1 pt-1 text-[10px] text-destructive">{error}</p> : null}
        </div>
      )}
    />
  )
}
