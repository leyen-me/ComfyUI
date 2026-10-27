import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

import type { ToolView } from '@/lib/agent-view'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

const STATUS_LABEL: Record<ToolView['status'], string> = {
  running: '执行中',
  waiting: '等待回答',
  ok: '已完成',
  error: '失败',
  paused: '已暂停',
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-[11px]"
      onClick={async () => {
        if (await copyText(value)) setCopied(true)
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? '已复制' : label}
    </Button>
  )
}

export function AgentToolDialog({
  tool,
  onClose,
}: {
  tool: ToolView | null
  onClose: () => void
}) {
  return (
    <Dialog
      open={tool !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={tool ? tool.label || tool.name : '工具'}
      description={tool ? `工具名 ${tool.name} · ${STATUS_LABEL[tool.status]}` : undefined}
      className="w-[min(880px,94vw)]"
      footer={<Button onClick={onClose}>关闭</Button>}
    >
      {tool ? (
        <div className="grid max-h-[62vh] gap-3 overflow-y-auto pb-3 md:grid-cols-2">
          <section className="min-w-0">
            <header className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                输入
              </span>
              <CopyButton value={tool.argsRaw} label="复制输入" />
            </header>
            <pre
              className={cn(
                'max-h-[48vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3',
                'font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85',
              )}
            >
              {tool.argsRaw || '（无参数）'}
            </pre>
          </section>
          <section className="min-w-0">
            <header className="mb-1.5 flex items-center justify-between">
              <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                输出
              </span>
              <CopyButton value={tool.resultRaw ?? ''} label="复制输出" />
            </header>
            <pre
              className={cn(
                'max-h-[48vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3',
                'font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85',
              )}
            >
              {tool.resultRaw ?? tool.summary ?? '（尚未返回）'}
            </pre>
          </section>
        </div>
      ) : null}
    </Dialog>
  )
}
