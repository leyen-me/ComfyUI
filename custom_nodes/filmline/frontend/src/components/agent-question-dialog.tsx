import { useEffect, useState } from 'react'

import type { AgentQuestion } from '@/lib/agent'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input } from './ui/field'

interface QuestionState {
  toolCallId: string
  questions: AgentQuestion[]
}

export function AgentQuestionDialog({
  state,
  onAnswer,
  onPause,
  busy,
}: {
  state: QuestionState | null
  onAnswer: (answers: Record<string, unknown>) => Promise<void> | void
  onPause: () => void
  busy: boolean
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})

  useEffect(() => {
    setSelected({})
    setCustom({})
  }, [state?.toolCallId])

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

  return (
    <Dialog
      open={state !== null}
      onOpenChange={() => {}}
      title="Agent 需要你的确认"
      description="回答后，Agent 会继续当前任务。"
      className="w-[min(600px,94vw)]"
      footer={
        <>
          <Button variant="ghost" onClick={onPause} disabled={busy}>
            暂停会话
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            提交回答
          </Button>
        </>
      }
    >
      <div className="max-h-[60vh] space-y-5 overflow-y-auto pb-3">
        {(state?.questions ?? []).map((question) => (
          <section key={question.id}>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {question.header}
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed">{question.question}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const active = (selected[question.id] ?? []).includes(option.label)
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => toggle(question, option.label)}
                    title={option.description}
                    className={cn(
                      'cursor-pointer rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <Input
              className="mt-2"
              value={custom[question.id] ?? ''}
              placeholder="也可以直接输入你的回答"
              onChange={(event) =>
                setCustom((previous) => ({ ...previous, [question.id]: event.target.value }))
              }
            />
          </section>
        ))}
      </div>
    </Dialog>
  )
}
