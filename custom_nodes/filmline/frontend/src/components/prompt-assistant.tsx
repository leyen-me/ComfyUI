import { AlertTriangle, ListTree, Loader2, Plus, Sparkles, X } from 'lucide-react'

import {
  fullTemplate,
  lintPrompt,
  modeHint,
  sectionsFor,
  snippetsFor,
  type AssistantCounts,
  type AssistantKeyframes,
  type AssistantMode,
  type AssistantVideoMode,
} from '@/lib/prompt-assistant'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface PromptAssistantProps {
  mode: AssistantMode
  videoMode: AssistantVideoMode
  keyframes: AssistantKeyframes
  counts: AssistantCounts
  prompt: string
  disabled?: boolean
  canOptimize: boolean
  optimizing: boolean
  optimizeError: string | null
  onOptimize: () => void
  onInsert: (text: string) => void
  onInsertTemplate: (text: string) => void
  onClose: () => void
}

/** 消息框右侧的结构助手：可插入模板、标签，并提示常见格式问题。 */
export function PromptAssistant({
  mode,
  videoMode,
  keyframes,
  counts,
  prompt,
  disabled = false,
  canOptimize,
  optimizing,
  optimizeError,
  onOptimize,
  onInsert,
  onInsertTemplate,
  onClose,
}: PromptAssistantProps) {
  const sections = sectionsFor(mode, videoMode, keyframes, counts)
  const snippets = snippetsFor(mode, videoMode, counts, keyframes)
  const warnings = lintPrompt({ mode, videoMode, prompt, counts })
  const hint = modeHint(mode, videoMode, keyframes)

  return (
    <aside
      aria-label="提示词结构助手"
      className="flex w-full shrink-0 flex-col rounded-lg border border-border bg-muted/20 p-2 lg:w-60"
    >
      <div className="flex items-start justify-between gap-2 px-0.5 pb-1.5">
        <div className="flex items-center gap-1.5">
          <ListTree className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">提示词助手</span>
        </div>
        <button
          type="button"
          aria-label="收起提示词助手"
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </button>
      </div>

      <p className="px-0.5 pb-2 text-[10px] leading-relaxed text-muted-foreground">{hint}</p>

      {canOptimize ? (
        <>
          <Button
            size="sm"
            variant="primary"
            className="mb-1.5 h-7 justify-center text-[11px]"
            disabled={disabled || optimizing}
            onClick={onOptimize}
          >
            {optimizing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                优化中…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                AI 优化提示词
              </>
            )}
          </Button>
          <p className="mb-2 px-0.5 text-[9px] leading-relaxed text-muted-foreground">
            会把当前首尾帧/参考图发送给 DeepSeek；不上传视频/音频。
          </p>
        </>
      ) : (
        <p className="mb-2 rounded-md bg-muted/40 px-1.5 py-1 text-[10px] leading-relaxed text-muted-foreground">
          AI 优化目前只支持视频提示词。
        </p>
      )}

      {optimizeError ? (
        <p className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-[10px] leading-relaxed text-destructive">
          {optimizeError}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mb-2 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-1.5">
          {warnings.map((warning) => (
            <div
              key={warning.id}
              className={cn(
                'flex gap-1 text-[10px] leading-relaxed',
                warning.level === 'error'
                  ? 'text-destructive'
                  : 'text-amber-700 dark:text-amber-400',
              )}
            >
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-1.5 py-1 text-[10px] text-emerald-700 dark:text-emerald-400">
          当前格式没有发现明显问题
        </p>
      )}

      <div className="max-h-64 overflow-y-auto pr-0.5">
        <div className="pb-1 text-[10px] font-medium text-muted-foreground">结构片段</div>
        <div className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              disabled={disabled}
              className="flex w-full cursor-pointer items-start gap-1.5 rounded-md border border-border bg-card px-1.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onInsertTemplate(section.template)}
            >
              <Plus className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate font-mono text-[10px] font-medium">
                  {section.title}
                </span>
                <span className="mt-0.5 block text-[9px] leading-relaxed text-muted-foreground">
                  {section.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="pt-2 pb-1 text-[10px] font-medium text-muted-foreground">快速插入</div>
        <div className="flex flex-wrap gap-1">
          {snippets.map((snippet) => (
            <button
              key={snippet.id}
              type="button"
              disabled={disabled}
              className="cursor-pointer rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => (snippet.block ? onInsertTemplate(snippet.text) : onInsert(snippet.text))}
            >
              {snippet.label}
            </button>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        variant="secondary"
        className="mt-2 h-7 justify-center text-[11px]"
        disabled={disabled}
        onClick={() => onInsertTemplate(fullTemplate(mode, videoMode, keyframes, counts))}
      >
        插入完整模板
      </Button>
    </aside>
  )
}
