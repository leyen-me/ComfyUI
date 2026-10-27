import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, CircleHelp, Loader2 } from 'lucide-react'

import type { AgentQuestion } from '@/lib/agent'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/field'

export interface PendingQuestion {
  toolCallId: string
  questions: AgentQuestion[]
}

/**
 * 输入框上方的非模态问答面板。
 *
 * 不用 <dialog>：用户需要一边看左侧素材、一边回答 Agent 的问题。
 * 收起后只留一条提示，素材区和输入框都还能正常操作。
 */
export function AgentQuestionPanel({
  state,
  onAnswer,
  onPause,
  busy,
}: {
  state: PendingQuestion | null
  onAnswer: (answers: Record<string, unknown>) => Promise<void> | void
  onPause: () => void
  busy: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  // 切换会话时把未提交的选项/展开状态按 toolCallId 暂存，切回来不丢
  const memory = useRef(
    new Map<
      string,
      {
        collapsed: boolean
        selected: Record<string, string[]>
        custom: Record<string, string>
      }
    >(),
  )
  const lastId = useRef<string | undefined>(undefined)
  const currentId = state?.toolCallId

  useEffect(() => {
    const previous = lastId.current
    if (previous && previous !== currentId) {
      memory.current.set(previous, { collapsed, selected, custom })
    }
    if (currentId) {
      const saved = memory.current.get(currentId)
      setCollapsed(saved?.collapsed ?? false)
      setSelected(saved?.selected ?? {})
      setCustom(saved?.custom ?? {})
    }
    lastId.current = currentId
    // 只在问题切换时保存/恢复；选择变化不触发这里
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  if (!state) return null

  function toggle(question: AgentQuestion, label: string) {
    setSelected((previous) => {
      const current = previous[question.id] ?? []
      if (question.multiple) {
        const exists = current.includes(label)
        return {
          ...previous,
          [question.id]: exists ? current.filter((item) => item !== label) : [...current, label],
        }
      }
      return { ...previous, [question.id]: [label] }
    })
  }

  function submit() {
    if (!state) return
    const answers: Record<string, unknown> = {}
    for (const question of state.questions) {
      const typed = (custom[question.id] ?? '').trim()
      if (typed) {
        answers[question.id] = typed
        continue
      }
      const picks = selected[question.id] ?? []
      answers[question.id] = question.multiple ? picks : (picks[0] ?? '')
    }
    void onAnswer(answers)
  }

  if (collapsed) {
    return (
      <div data-agent-question className="shrink-0 px-6 pb-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="mx-auto flex w-full max-w-3xl cursor-pointer items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-amber-500/10 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        >
          <CircleHelp className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="shrink-0 font-medium text-amber-700 dark:text-amber-300">
            Agent 有 {state.questions.length} 个问题待回答
          </span>
          <span className="hidden min-w-0 truncate text-muted-foreground sm:block">
            {state.questions[0]?.question}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-amber-700 dark:text-amber-300">
            展开回答
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        </button>
      </div>
    )
  }

  return (
    <div data-agent-question className="shrink-0 px-6 pb-2">
      <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-[16px] border border-amber-500/35 bg-card shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-3.5 py-2">
          <CircleHelp className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-[12px] font-medium text-amber-800 dark:text-amber-200">
            Agent 需要你的确认
          </span>
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            可以先收起面板，查看左侧素材后再回答
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="收起，先看素材"
            className="ml-auto flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            收起
            <ChevronUp className="size-3" />
          </button>
        </div>

        <div className="max-h-[40vh] space-y-4 overflow-y-auto px-4 py-3">
          {state.questions.map((question, index) => (
            <section key={question.id}>
              <div className="flex items-baseline gap-2">
                <span className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
                  {question.header}
                </span>
                {state.questions.length > 1 ? (
                  <span className="text-[10.5px] text-muted-foreground/60">
                    {index + 1}/{state.questions.length}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground">{question.question}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {question.options.map((option) => {
                  const active = (selected[question.id] ?? []).includes(option.label)
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => toggle(question, option.label)}
                      title={option.description}
                      aria-pressed={active}
                      className={cn(
                        'cursor-pointer rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
                        active
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <Input
                className="mt-2 h-8 text-[12.5px]"
                value={custom[question.id] ?? ''}
                placeholder="也可以直接输入你的回答"
                onChange={(event) =>
                  setCustom((previous) => ({ ...previous, [question.id]: event.target.value }))
                }
              />
            </section>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3.5 py-2">
          <Button variant="ghost" size="sm" onClick={onPause} disabled={busy}>
            暂停会话
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            onClick={submit}
            disabled={busy}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            提交回答
          </Button>
        </div>
      </div>
    </div>
  )
}
