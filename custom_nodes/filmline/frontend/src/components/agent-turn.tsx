import { useState } from 'react'
import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  Music,
  Pause,
  Sparkles,
  Video,
  Wrench,
  X,
} from 'lucide-react'

import type { ToolView, TurnView } from '@/lib/agent-view'
import { finalStep } from '@/lib/agent-view'
import { cn } from '@/lib/utils'

const KIND_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileText,
} as const

const TOOL_STATUS: Record<ToolView['status'], { text: string; className: string }> = {
  running: { text: '执行中', className: 'text-sky-600 dark:text-sky-400' },
  waiting: { text: '等待回答', className: 'text-amber-600 dark:text-amber-400' },
  ok: { text: '', className: 'text-emerald-600 dark:text-emerald-400' },
  error: { text: '失败', className: 'text-destructive' },
  paused: { text: '已暂停', className: 'text-amber-600 dark:text-amber-400' },
}

export function AgentToolRow({
  tool,
  onOpen,
  onPause,
}: {
  tool: ToolView
  onOpen: () => void
  onPause?: () => void
}) {
  const status = TOOL_STATUS[tool.status]
  return (
    <div className="group flex items-center gap-2 py-0.5">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left text-[13px]',
          'text-sky-700 underline decoration-sky-500/40 underline-offset-4 hover:decoration-sky-500 dark:text-sky-400',
        )}
        title="查看工具输入与输出"
      >
        {tool.status === 'running' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
        ) : tool.status === 'ok' ? (
          <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : tool.status === 'error' ? (
          <X className="size-3.5 shrink-0 text-destructive" />
        ) : tool.status === 'paused' ? (
          <Pause className="size-3.5 shrink-0" />
        ) : (
          <Wrench className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{tool.label || tool.name}</span>
        <span className={cn('shrink-0 text-[11px] no-underline', status.className)}>
          {tool.progress || status.text}
        </span>
        {tool.percent !== undefined && tool.percent !== null ? (
          <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            {tool.percent}%
          </span>
        ) : null}
      </button>
      {(tool.status === 'running' || tool.status === 'waiting') && onPause ? (
        <button
          type="button"
          onClick={onPause}
          title="暂停这个工具"
          className="cursor-pointer rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          <Pause className="size-3" />
        </button>
      ) : null}
    </div>
  )
}

function CollapsibleBlock({
  title,
  children,
  tone,
}: {
  title: string
  children: React.ReactNode
  tone?: 'reasoning' | 'content'
}) {
  return (
    <div className="mb-2 last:mb-0">
      {title ? (
        <p className="mb-1 text-[10.5px] font-medium tracking-wide text-muted-foreground/70 uppercase">
          {title}
        </p>
      ) : null}
      <div
        className={cn(
          'whitespace-pre-wrap break-words',
          tone === 'reasoning'
            ? 'text-[12.5px] leading-relaxed font-light italic text-muted-foreground/80'
            : 'text-[13px] leading-relaxed text-foreground/85',
        )}
      >
        {children}
      </div>
    </div>
  )
}

export function AgentTurn({
  turn,
  running,
  onOpenTool,
  onPauseTool,
}: {
  turn: TurnView
  running: boolean
  onOpenTool: (tool: ToolView) => void
  onPauseTool: (toolCallId: string) => void
}) {
  const [expanded, setExpanded] = useState(running)
  const final = finalStep(turn)
  const detailSteps = turn.steps.filter((step) => !step.discarded && step !== final)
  const finalReasoning = final?.reasoning ?? ''
  const hasDetails = detailSteps.length > 0 || finalReasoning.trim().length > 0
  const toolCount = turn.steps.reduce((sum, step) => sum + step.tools.length, 0)

  return (
    <article className="animate-rise py-5">
      {turn.user ? (
        turn.user.notice ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p className="min-w-0 whitespace-pre-wrap break-words">
              <span className="mr-1.5 font-medium text-foreground/70">系统通知</span>
              {turn.user.text}
            </p>
          </div>
        ) : (
          <div className="mb-3 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted/70 px-4 py-2.5">
            {turn.user.text ? (
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">
                {turn.user.text}
              </p>
            ) : null}
            {turn.user.assets.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {turn.user.assets.map((asset) => {
                  const Icon = KIND_ICON[asset.kind as keyof typeof KIND_ICON] ?? FileText
                  return (
                    <span
                      key={`${asset.kind}-${asset.id}`}
                      className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      <Icon className="size-3 shrink-0" />
                      <span className="truncate">{asset.name}</span>
                      <span className="shrink-0 font-mono text-[10px] opacity-60">#{asset.id}</span>
                    </span>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      ) : null}

      {hasDetails ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex cursor-pointer items-center gap-1.5 rounded-md py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            <Brain className="size-3.5" />
            <span>
              深度思考与工具调用
              {toolCount ? ` · ${toolCount} 个工具` : ''}
            </span>
            {running ? <Loader2 className="size-3 animate-spin" /> : null}
          </button>
          {expanded ? (
            <div className="mt-2 rounded-xl border border-border/70 bg-muted/20 px-3.5 py-3">
              {finalReasoning.trim() ? (
                <CollapsibleBlock title="深度思考" tone="reasoning">
                  {finalReasoning}
                </CollapsibleBlock>
              ) : null}
              {detailSteps.map((step) => (
                <div key={step.step} className="mb-3 last:mb-0">
                  {step.reasoning.trim() ? (
                    <CollapsibleBlock title="深度思考" tone="reasoning">
                      {step.reasoning}
                    </CollapsibleBlock>
                  ) : null}
                  {step.content.trim() ? (
                    <CollapsibleBlock title="中间输出" tone="content">
                      {step.content}
                    </CollapsibleBlock>
                  ) : null}
                  {step.tools.map((tool) => (
                    <AgentToolRow
                      key={tool.id}
                      tool={tool}
                      onOpen={() => onOpenTool(tool)}
                      onPause={() => onPauseTool(tool.id)}
                    />
                  ))}
                </div>
              ))}
              {detailSteps.length === 0 && !finalReasoning.trim() && running ? (
                <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在处理…
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {final && final.content.trim() ? (
        <div className="text-[14px] leading-7 whitespace-pre-wrap break-words text-foreground">
          {final.content}
        </div>
      ) : null}

      {running && !final?.content.trim() && !hasDetails ? (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Sparkles className="size-3.5 animate-pulse text-primary" />
          正在思考…
        </div>
      ) : null}

      {turn.question && !turn.question.answers ? (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
          <AlertCircle className="size-3.5 shrink-0" />
          等待你回答问题，确认后继续。
        </div>
      ) : null}
      {turn.question?.answers ? (
        <p className="mt-2 text-[11.5px] text-muted-foreground">已回答，Agent 继续执行。</p>
      ) : null}

      {turn.errors.map((message, index) => (
        <p
          key={`${message}-${index}`}
          className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-destructive"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {message}
        </p>
      ))}
    </article>
  )
}
