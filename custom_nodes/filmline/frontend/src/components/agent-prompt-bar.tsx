import { useEffect, useState } from 'react'
import { Check, ChevronDown, Copy, ScrollText } from 'lucide-react'

import type { AgentSystemPrompt } from '@/lib/agent'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

const THINKING_LABEL: Record<string, string> = {
  auto: '默认（由 provider 决定）',
  enabled: '开启',
  disabled: '关闭',
}

/**
 * 顶部系统提示：收起时保留预览与字符数，展开后原样展示实际发送的 prompt。
 * 让用户随时可以核对 Agent 到底被要求做什么，而不是只能相信界面描述。
 */
export function AgentPromptBar({ info }: { info: AgentSystemPrompt | null }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!info) return null

  const preview = info.prompt.replace(/\s+/g, ' ').trim()
  const thinking =
    info.thinking === 'enabled' && info.reasoning_effort
      ? `开启 · ${info.reasoning_effort}`
      : (THINKING_LABEL[info.thinking] ?? info.thinking)

  return (
    <section aria-label="系统提示" className="shrink-0 border-b border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-left text-[11.5px] transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <ScrollText className="size-3.5 shrink-0 text-primary" />
        <span className="shrink-0 font-medium text-foreground">系统提示</span>
        <span className="hidden min-w-0 flex-1 truncate text-muted-foreground sm:block">
          {preview}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted-foreground">
          {info.chars} 字符
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div className="max-h-[42vh] overflow-y-auto border-t border-border/70 px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{info.model}</span>
            <span>·</span>
            <span>全局思考默认：{thinking}</span>
            <span>·</span>
            <span>{info.tool_count} 个工具</span>
            <span>·</span>
            <span className="font-mono" title={info.sha256}>
              sha256 {info.sha256.slice(0, 12)}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-[11px]"
              onClick={async () => {
                if (await copyText(info.prompt)) setCopied(true)
              }}
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? '已复制' : '复制系统提示'}
            </Button>
          </div>

          <pre className="rounded-lg border border-border bg-card/70 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
            {info.prompt}
          </pre>

          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{info.note}</p>

          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
              已启用工具（{info.tool_count}）
            </summary>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {info.tools.map((tool) => (
                <span
                  key={tool.name}
                  title={tool.description}
                  className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {tool.name}
                </span>
              ))}
            </div>
          </details>
        </div>
      ) : null}
    </section>
  )
}
