import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Popover } from './ui/popover'

export const IMAGE_RATIOS = [
  { value: '16:9', label: '横屏 16:9' },
  { value: '9:16', label: '竖屏 9:16' },
  { value: '1:1', label: '方形 1:1' },
] as const

export const VIDEO_RATIOS = [
  { value: '16:9', label: '横屏 16:9' },
  { value: '9:16', label: '竖屏 9:16' },
] as const

/** 与后端 generation.IMAGE_TIERS 保持一致（2K 为官方原生，不提供 4K） */
export const IMAGE_TIERS = [
  { value: '1k', label: '1K', hint: '快' },
  { value: '2k', label: '2K', hint: '原生' },
] as const

/** 视频只有两档：短边 512 预览 / 768 官方原生 */
export const VIDEO_TIERS = [
  { value: '512', label: '512', hint: '预览' },
  { value: '768', label: '768', hint: '原生' },
] as const

interface GenerationOptionsProps {
  mode: 'image' | 'video'
  size: string
  tier: string
  onSizeChange: (size: string) => void
  onTierChange: (tier: string) => void
}

/** 一个按钮打开「比例 + 分辨率」两组选项。 */
export function GenerationOptions({
  mode,
  size,
  tier,
  onSizeChange,
  onTierChange,
}: GenerationOptionsProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  const ratios = mode === 'image' ? IMAGE_RATIOS : VIDEO_RATIOS
  const tiers = mode === 'image' ? IMAGE_TIERS : VIDEO_TIERS
  const tierLabel = tiers.find((item) => item.value === tier)?.label ?? tiers[0].label

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="尺寸与分辨率"
        className="flex h-7 items-center gap-1 rounded-lg border border-border bg-input px-2 text-xs text-foreground transition-colors hover:border-ring/60"
        onClick={() => setOpen((value) => !value)}
      >
        {size} · {tierLabel}
        <ChevronDown className="size-3 opacity-60" />
      </button>

      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={236}>
        <div className="px-1.5 pb-1 text-[11px] text-muted-foreground">比例</div>
        <div className="flex flex-wrap gap-1">
          {ratios.map((item) => (
            <OptionButton
              key={item.value}
              active={item.value === size}
              onClick={() => {
                onSizeChange(item.value)
                if (mode === 'video') setOpen(false)
              }}
            >
              {item.label}
            </OptionButton>
          ))}
        </div>

        <div className="px-1.5 pt-2.5 pb-1 text-[11px] text-muted-foreground">分辨率</div>
        <div className="flex flex-wrap gap-1">
          {tiers.map((item) => (
            <OptionButton
              key={item.value}
              active={item.value === tier}
              onClick={() => {
                onTierChange(item.value)
                if (mode === 'video') setOpen(false)
              }}
            >
              {item.label}
              <span className="ml-1 text-[10px] opacity-60">{item.hint}</span>
            </OptionButton>
          ))}
        </div>
      </Popover>
    </>
  )
}

function OptionButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center rounded-md border px-2 py-1 text-xs transition-colors',
        active
          ? 'border-primary/40 bg-accent font-medium text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
