import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import type { PromptOptimizeResult } from '@/lib/api'
import {
  lintPrompt,
  type AssistantCounts,
  type AssistantMode,
  type AssistantVideoMode,
} from '@/lib/prompt-assistant'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Textarea } from './ui/field'

interface PromptOptimizeDialogProps {
  open: boolean
  original: string
  result: PromptOptimizeResult | null
  mode: AssistantMode
  videoMode: AssistantVideoMode
  counts: AssistantCounts
  onOpenChange: (open: boolean) => void
  onApply: (text: string) => void
}

/** AI 优化结果预览：明确对比原文与优化稿，用户确认后才替换。 */
export function PromptOptimizeDialog({
  open,
  original,
  result,
  mode,
  videoMode,
  counts,
  onOpenChange,
  onApply,
}: PromptOptimizeDialogProps) {
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (open) setDraft(result?.enhanced_prompt ?? '')
  }, [open, result])

  const warnings = [
    ...(result?.warnings ?? []),
    ...lintPrompt({ mode, videoMode, prompt: draft, counts }).map((item) => item.message),
  ]

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="AI 优化提示词"
      description="DeepSeek 生成；只替换提示词文本，不会自动提交生成。应用前请检查说话人、首尾帧和标签。"
      className="sm:w-[min(920px,96vw)]"
      mobileFullHeight
      footer={
        <>
          <span className="mr-auto self-center font-mono text-[10px] text-muted-foreground">
            {result?.model ? `${result.model} · ` : ''}
            {draft.length} 字符
          </span>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="primary"
            disabled={!draft.trim()}
            onClick={() => {
              onApply(draft.trim())
              onOpenChange(false)
            }}
          >
            应用并替换
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
      <div className="grid min-h-0 gap-3 max-sm:flex-1 max-sm:flex-col md:grid-cols-2">
        <div className="flex min-h-0 flex-col max-sm:flex-1">
          <div className="mb-1 shrink-0 text-[11px] text-muted-foreground">原文</div>
          <Textarea
            readOnly
            value={original}
            rows={10}
            className="h-[42vh] resize-none font-mono text-[11px] leading-relaxed max-sm:h-auto max-sm:min-h-0 max-sm:flex-1"
          />
        </div>
        <div className="flex min-h-0 flex-col max-sm:flex-1">
          <div className="mb-1 shrink-0 text-[11px] text-muted-foreground">优化后（可编辑）</div>
          <Textarea
            value={draft}
            rows={10}
            aria-label="优化后的提示词"
            className="h-[42vh] resize-none font-mono text-[11px] leading-relaxed max-sm:h-auto max-sm:min-h-0 max-sm:flex-1"
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
      </div>

      {warnings.length > 0 ? (
        <div className="mb-0 shrink-0 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2">
          <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400">AI 提醒</p>
          {warnings.map((warning, index) => (
            <p
              key={`${index}-${warning}`}
              className={cn(
                'flex gap-1 text-[11px] leading-relaxed',
                'text-amber-700 dark:text-amber-400',
              )}
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}

      {result?.notes ? (
        <p className="shrink-0 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">说明：</span>
          {result.notes}
        </p>
      ) : null}
      </div>
    </Dialog>
  )
}
