import { Sparkles, Upload } from 'lucide-react'

import type { AssetKind, AssetSource } from '@/lib/api'
import { cn } from '@/lib/utils'

/** 来源标记：区分 ComfyUI 生成与用户自建。 */
export function SourceBadge({ source, kind }: { source: AssetSource; kind: AssetKind }) {
  const isAi = source === 'ai'
  const label = isAi ? 'AI 生成' : kind === 'text' ? '用户创建' : '用户上传'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-medium ring-1 ring-inset backdrop-blur-sm',
        isAi
          ? 'bg-primary/15 text-primary ring-primary/30'
          : 'bg-background/70 text-muted-foreground ring-border',
      )}
      title={isAi ? '由 ComfyUI 生成' : '由用户创建或上传'}
    >
      {isAi ? <Sparkles className="size-2.5" /> : <Upload className="size-2.5" />}
      {label}
    </span>
  )
}
