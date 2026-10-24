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
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        isAi
          ? 'bg-violet-500/12 text-violet-600 ring-violet-500/25 dark:text-violet-300'
          : 'bg-muted text-muted-foreground ring-border',
      )}
      title={isAi ? '由 ComfyUI 生成' : '由用户创建或上传'}
    >
      {isAi ? <Sparkles className="size-3" /> : <Upload className="size-3" />}
      {label}
    </span>
  )
}
