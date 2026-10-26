import { useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Popover } from './ui/popover'

export type RefQuality = 'quality' | 'fast'
export type RefScheduler = 'simple' | 'beta' | 'normal'
export type RefImageSize = 'match' | 'max'

interface ReferenceSettingsProps {
  disabled?: boolean
  quality: RefQuality
  scheduler: RefScheduler
  imageSize: RefImageSize
  autoDuration: boolean
  canAutoDuration: boolean
  seedEnabled: boolean
  seed: number
  onQualityChange: (value: RefQuality) => void
  onSchedulerChange: (value: RefScheduler) => void
  onImageSizeChange: (value: RefImageSize) => void
  onAutoDurationChange: (value: boolean) => void
  onSeedEnabledChange: (value: boolean) => void
  onSeedChange: (value: number) => void
}

const QUALITY_HINT: Record<RefQuality, string> = {
  quality: '20 步 · 不挂 LoRA',
  fast: '8 步 · turbo 0.7',
}

/**
 * 参考生成的采样与素材选项。
 * 默认对齐官方模板：20 步、不挂 turbo LoRA、match 参考图尺寸。
 */
export function ReferenceSettings({
  disabled = false,
  quality,
  scheduler,
  imageSize,
  autoDuration,
  canAutoDuration,
  seedEnabled,
  seed,
  onQualityChange,
  onSchedulerChange,
  onImageSizeChange,
  onAutoDurationChange,
  onSeedEnabledChange,
  onSeedChange,
}: ReferenceSettingsProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="参考生成设置"
        title="参考画质、参考图尺寸、采样调度与固定种子"
        className="flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-border bg-input px-2 text-xs text-foreground transition-colors hover:border-ring/60 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal className="size-3 opacity-60" />
        {quality === 'quality' ? '质量' : '快速'}
      </button>

      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={300}>
        <div className="px-1.5 pb-1 text-[11px] font-medium text-foreground">参考画质</div>
        <div className="flex gap-1">
          <Option
            active={quality === 'quality'}
            onClick={() => onQualityChange('quality')}
            title="官方基线：20 步、不挂 LoRA"
          >
            质量
            <span className="ml-1 text-[10px] opacity-60">{QUALITY_HINT.quality}</span>
          </Option>
          <Option
            active={quality === 'fast'}
            onClick={() => onQualityChange('fast')}
            title="8 步 + turbo LoRA 0.7，速度优先"
          >
            快速
            <span className="ml-1 text-[10px] opacity-60">{QUALITY_HINT.fast}</span>
          </Option>
        </div>

        <div className="px-1.5 pt-2.5 pb-1 text-[11px] text-muted-foreground">参考图尺寸</div>
        <div className="flex gap-1">
          <Option
            active={imageSize === 'match'}
            onClick={() => onImageSizeChange('match')}
            title="缩到生成像素面积，速度更快"
          >
            匹配
            <span className="ml-1 text-[10px] opacity-60">match</span>
          </Option>
          <Option
            active={imageSize === 'max'}
            onClick={() => onImageSizeChange('max')}
            title="保留 2048 短边，身份更准但更慢"
          >
            保真
            <span className="ml-1 text-[10px] opacity-60">max</span>
          </Option>
        </div>

        <div className="px-1.5 pt-2.5 pb-1 text-[11px] text-muted-foreground">采样调度</div>
        <div className="flex gap-1">
          {(['simple', 'beta', 'normal'] as const).map((item) => (
            <Option
              key={item}
              active={scheduler === item}
              onClick={() => onSchedulerChange(item)}
              title={item === 'simple' ? '官方模板默认' : '参考重的提示词可对比测试'}
            >
              {item}
            </Option>
          ))}
        </div>

        <label
          className={cn(
            'mt-2.5 flex cursor-pointer items-center gap-1.5 px-1 text-[11px] text-foreground',
            !canAutoDuration && 'cursor-not-allowed opacity-50',
          )}
          title={
            canAutoDuration
              ? '按最长的一段参考音频自动计算时长'
              : '需要至少一段参考音频（独立音频或视频原声）'
          }
        >
          <input
            type="checkbox"
            className="size-3 accent-primary"
            checked={autoDuration}
            disabled={disabled || !canAutoDuration}
            onChange={(event) => onAutoDurationChange(event.target.checked)}
          />
          按参考音频自动定时长
        </label>

        <div className="mt-1.5 flex items-center gap-1.5 px-1">
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-foreground">
            <input
              type="checkbox"
              className="size-3 accent-primary"
              checked={seedEnabled}
              disabled={disabled}
              onChange={(event) => onSeedEnabledChange(event.target.checked)}
            />
            固定种子
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={2147483647}
            step={1}
            value={seed}
            disabled={disabled || !seedEnabled}
            aria-label="固定随机种子"
            className="h-6 w-24 rounded border border-border bg-input px-1.5 font-mono text-[11px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-40"
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next)) onSeedChange(Math.max(0, Math.min(2147483647, Math.trunc(next))))
            }}
          />
          <button
            type="button"
            disabled={disabled || !seedEnabled}
            className="ml-auto cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => onSeedChange(Math.floor(Math.random() * 2147483647))}
          >
            随机
          </button>
        </div>
        <p className="mt-1 px-1 text-[10px] leading-relaxed text-muted-foreground/80">
          质量档参考 token 每一步都参与采样；身份/口型锁不住时优先加大步数，而不是降分辨率。
        </p>
      </Popover>
    </>
  )
}

function Option({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
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
