import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageSquarePlus,
  Music,
  Pause,
  Play,
  Plus,
  SendHorizontal,
  Sparkles,
  Trash2,
  Video,
  X,
} from 'lucide-react'

import { ApiError, type Project } from '@/lib/api'
import {
  agentApi,
  subscribeAgentEvents,
  type AgentAssetRef,
  type AgentSession,
  type AgentSystemPrompt,
} from '@/lib/agent'
import {
  applyEvent,
  contextLabel,
  emptyView,
  pendingQuestion,
  type AgentView,
  type ToolView,
} from '@/lib/agent-view'
import { hasAssetDrag, readAssetDrag, type AssetDragPayload } from '@/lib/asset-drag'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AgentPromptBar } from './agent-prompt-bar'
import { AgentQuestionDialog } from './agent-question-dialog'
import { AgentToolDialog } from './agent-tool-dialog'
import { AgentTurn } from './agent-turn'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Popover } from './ui/popover'

const KIND_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileText,
} as const

const STATUS_LABEL: Record<AgentSession['status'], string> = {
  idle: '待命',
  running: '运行中',
  waiting_input: '等待回答',
  paused: '已暂停',
  interrupted: '已中断',
  error: '出错',
}

const MAX_ATTACHMENTS = 12

export function AgentPanel({ project }: { project: Project }) {
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [view, setView] = useState<AgentView>(emptyView)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'closed'>('closed')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AssetDragPayload[]>([])
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tool, setTool] = useState<ToolView | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [model, setModel] = useState<{ model: string; context_window: number; configured: boolean }>({
    model: '',
    context_window: 1_000_000,
    configured: true,
  })
  const [systemPrompt, setSystemPrompt] = useState<AgentSystemPrompt | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const titleRef = useRef<HTMLButtonElement>(null)

  const notify = useCallback((message: string, tone: ToastMessage['tone'] = 'ok') => {
    setToast({ id: Date.now(), text: message, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    let disposed = false
    agentApi
      .systemPrompt()
      .then((data) => {
        if (!disposed) setSystemPrompt(data)
      })
      .catch(() => {
        // 提示栏加载失败不影响会话本身
      })
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let disposed = false
    setLoading(true)
    agentApi
      .listSessions(project.code)
      .then((data) => {
        if (disposed) return
        setSessions(data.items)
        setModel({
          model: data.model,
          context_window: data.context_window,
          configured: data.configured,
        })
        setActiveId((current) => current ?? data.items[0]?.id ?? null)
      })
      .catch((cause) => {
        if (!disposed) notify(cause instanceof ApiError ? cause.fullMessage : '加载会话失败', 'error')
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [project.code, notify])

  useEffect(() => {
    if (activeId === null) {
      setView(emptyView)
      setConnection('closed')
      return
    }
    let disposed = false
    setView(emptyView)
    setConnection('connecting')

    agentApi
      .getSession(activeId)
      .then((session) => {
        if (disposed) return
        setView((previous) =>
          previous.lastSeq > 0
            ? previous
            : { ...previous, status: session.status, usage: session.usage },
        )
      })
      .catch(() => {
        if (!disposed) setConnection('closed')
      })

    const stop = subscribeAgentEvents(activeId, 0, {
      onEvent: (event) => {
        if (disposed) return
        setView((previous) => applyEvent(previous, event))
        if (event.type === 'session.status' || event.type === 'run.finished') {
          const next = event.data.status
          if (typeof next === 'string') {
            setSessions((previous) =>
              previous.map((item) =>
                item.id === activeId
                  ? { ...item, status: next === 'done' ? 'idle' : (next as AgentSession['status']) }
                  : item,
              ),
            )
          }
        }
        if (event.type === 'user.message') {
          setSessions((previous) =>
            previous.map((item) =>
              item.id === activeId ? { ...item, updated_at: new Date().toISOString() } : item,
            ),
          )
        }
      },
      onState: setConnection,
      onError: () => {
        // 断线只改连接指示；自动重连成功后从 after 补齐，不用反复弹错误
        if (!disposed) setConnection('connecting')
      },
    })

    return () => {
      disposed = true
      stop()
    }
  }, [activeId, notify])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stick.current) return
    element.scrollTop = element.scrollHeight
  }, [view.lastSeq, view.turns.length])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${Math.min(200, Math.max(52, element.scrollHeight))}px`
  }, [text])

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeId) ?? null,
    [sessions, activeId],
  )
  const status = view.status ?? activeSession?.status ?? 'idle'
  const running = status === 'running' || status === 'waiting_input'
  const paused = status === 'paused' || status === 'interrupted' || status === 'error'
  const question = status === 'waiting_input' ? pendingQuestion(view) : undefined

  function addAttachment(payload: AssetDragPayload) {
    setAttachments((previous) => {
      if (previous.some((item) => item.assetId === payload.assetId)) return previous
      if (previous.length >= MAX_ATTACHMENTS) {
        notify(`单条消息最多 ${MAX_ATTACHMENTS} 个附件`, 'error')
        return previous
      }
      return [...previous, payload]
    })
  }

  async function ensureSession(): Promise<number> {
    if (activeId !== null) return activeId
    const created = await agentApi.createSession(project.code)
    setSessions((previous) => [created, ...previous])
    setActiveId(created.id)
    return created.id
  }

  async function handleSend() {
    const body = text.trim()
    if ((!body && attachments.length === 0) || sending) return
    if (running) {
      notify('Agent 正在运行，请先暂停再发送新消息', 'error')
      return
    }
    setSending(true)
    try {
      const id = await ensureSession()
      await agentApi.sendMessage(
        id,
        body,
        attachments.map((item) => item.assetId),
      )
      setText('')
      setAttachments([])
      stick.current = true
      const refreshed = await agentApi.getSession(id)
      setSessions((previous) =>
        previous.map((item) => (item.id === id ? { ...item, ...refreshed } : item)),
      )
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '发送失败', 'error')
    } finally {
      setSending(false)
    }
  }

  async function handlePause() {
    if (activeId === null) return
    setBusy(true)
    try {
      await agentApi.pause(activeId)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '暂停失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    if (activeId === null) return
    setBusy(true)
    try {
      await agentApi.resume(activeId)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '继续失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handlePauseTool(toolCallId: string) {
    if (activeId === null) return
    try {
      await agentApi.pauseTool(activeId, toolCallId)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '暂停工具失败', 'error')
    }
  }

  async function handleAnswer(answers: Record<string, unknown>) {
    if (activeId === null || !question) return
    setBusy(true)
    try {
      await agentApi.answer(activeId, question.question!.toolCallId, answers)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '提交回答失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function createSession() {
    try {
      const created = await agentApi.createSession(project.code)
      setSessions((previous) => [created, ...previous])
      setActiveId(created.id)
      setMenuOpen(false)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '新建会话失败', 'error')
    }
  }

  async function removeSession(id: number) {
    try {
      await agentApi.deleteSession(id)
      setSessions((previous) => previous.filter((item) => item.id !== id))
      if (activeId === id) {
        const next = sessions.find((item) => item.id !== id)
        setActiveId(next?.id ?? null)
      }
      setMenuOpen(false)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除会话失败', 'error')
    }
  }

  const context = contextLabel(view.usage, activeSession?.context_window ?? model.context_window)
  const attachmentsView: AgentAssetRef[] = attachments.map((item) => ({
    id: item.assetId,
    kind: item.kind,
    name: item.name,
  }))

  return (
    <aside className="flex min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <button
          ref={titleRef}
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
        >
          <span className="truncate">{activeSession?.title ?? '新对话'}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <span
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[10.5px]',
            running
              ? 'bg-primary/10 text-primary'
              : paused
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {STATUS_LABEL[status as AgentSession['status']] ?? status}
        </span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              'size-1.5 rounded-full',
              connection === 'live'
                ? 'bg-emerald-500'
                : connection === 'connecting'
                  ? 'animate-pulse bg-amber-500'
                  : 'bg-muted-foreground/40',
            )}
            title={connection === 'live' ? '事件流已连接' : '事件流连接中'}
          />
          <span className="hidden sm:inline">{model.model || 'agent'}</span>
          <span className="font-mono tabular-nums" title="上下文占用">
            {context}
          </span>
          <button
            type="button"
            onClick={createSession}
            title="新建对话"
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </header>

      <AgentPromptBar info={systemPrompt} />

      <Popover open={menuOpen} onOpenChange={setMenuOpen} anchorRef={titleRef} width={320}>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          <button
            type="button"
            onClick={createSession}
            className="mb-1 flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MessageSquarePlus className="size-3.5" />
            新建对话
          </button>
          {sessions.length === 0 ? (
            <p className="px-2.5 py-3 text-[12px] text-muted-foreground">还没有对话</p>
          ) : null}
          {sessions.map((item) => (
            <div
              key={item.id}
              className={cn(
                'group flex items-center gap-1 rounded-lg pr-1',
                item.id === activeId ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveId(item.id)
                  setMenuOpen(false)
                }}
                className="min-w-0 flex-1 cursor-pointer px-2.5 py-2 text-left"
              >
                <span className="block truncate text-[12.5px] text-foreground">{item.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span>{STATUS_LABEL[item.status] ?? item.status}</span>
                  <span>·</span>
                  <span>{formatRelative(item.updated_at)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => removeSession(item.id)}
                title="删除对话"
                className="cursor-pointer rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </Popover>

      <div
        ref={scrollRef}
        onScroll={() => {
          const element = scrollRef.current
          if (!element) return
          stick.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 90
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              加载会话…
            </div>
          ) : view.turns.length === 0 ? (
            <div className="flex h-[45vh] flex-col items-center justify-center text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20">
                <Sparkles className="size-5" />
              </span>
              <h2 className="mt-5 text-lg font-semibold tracking-tight">把想法交给 Agent</h2>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
                描述你要做的镜头、要改的资产，或者直接问项目里有什么。左侧的文字、图片、视频都可以拖进输入框。
              </p>
            </div>
          ) : (
            view.turns.map((turn) => (
              <AgentTurn
                key={turn.turn}
                turn={turn}
                running={running && turn.turn === view.turns[view.turns.length - 1]?.turn}
                onOpenTool={setTool}
                onPauseTool={(id) => void handlePauseTool(id)}
              />
            ))
          )}
          {paused ? (
            <div className="my-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300">
              <Pause className="size-3.5 shrink-0" />
              会话已{paused && status === 'interrupted' ? '中断' : '暂停'}。可以继续，或直接输入新的要求。
            </div>
          ) : null}
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
        onDragOver={(event) => {
          if (!hasAssetDrag(event.dataTransfer)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(event) => {
          const payload = readAssetDrag(event.dataTransfer)
          if (!payload) return
          event.preventDefault()
          addAttachment(payload)
        }}
        className="shrink-0 px-6 pt-1 pb-5"
      >
        <div className="mx-auto w-full max-w-3xl rounded-[20px] border border-border bg-elevated p-2.5 shadow-[var(--shadow-soft)] transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-[var(--shadow-pop)]">
          {attachmentsView.length ? (
            <div className="flex flex-wrap gap-1.5 px-1 pt-0.5 pb-2">
              {attachmentsView.map((item) => {
                const Icon = KIND_ICON[item.kind as keyof typeof KIND_ICON] ?? FileText
                return (
                  <span
                    key={item.id}
                    className="inline-flex max-w-[240px] items-center gap-1 rounded-md border border-border bg-muted/50 py-0.5 pr-1 pl-1.5 text-[11px] text-muted-foreground"
                  >
                    <Icon className="size-3 shrink-0" />
                    <span className="truncate">{item.name}</span>
                    <span className="shrink-0 font-mono text-[10px] opacity-60">#{item.id}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((previous) => previous.filter((one) => one.assetId !== item.id))
                      }
                      className="cursor-pointer rounded p-0.5 hover:bg-muted hover:text-foreground"
                      aria-label={`移除 ${item.name}`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          ) : null}
          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            placeholder={
              running
                ? 'Agent 运行中，可以先想下一步；暂停后才能发送新消息'
                : '描述你要做的事，或者把左侧素材拖进来…'
            }
            aria-label="给 Agent 的消息"
            className="block max-h-[200px] min-h-[52px] w-full resize-none bg-transparent px-2 py-2 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return
              if (event.nativeEvent.isComposing) return
              event.preventDefault()
              void handleSend()
            }}
          />
          <div className="flex items-center gap-2 px-1 pt-1">
            <span className="truncate text-[10.5px] text-muted-foreground">
              {model.configured ? 'Enter 发送 · Shift+Enter 换行' : '未配置模型 API Key'}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              {running ? (
                <button
                  type="button"
                  onClick={() => void handlePause()}
                  disabled={busy}
                  title="暂停 Agent（同时中断正在执行的工具）"
                  className={cn(
                    'flex size-8 cursor-pointer items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-85 disabled:opacity-40',
                  )}
                >
                  <Pause className="size-4" />
                </button>
              ) : (
                <>
                  {paused ? (
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => void handleResume()}
                      disabled={busy}
                      title="继续会话"
                      className="rounded-full"
                    >
                      <Play className="size-4" />
                    </Button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={sending || (!text.trim() && attachments.length === 0)}
                    title="发送"
                    className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-35"
                  >
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <SendHorizontal className="size-4" />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </form>

      <AgentToolDialog tool={tool} onClose={() => setTool(null)} />
      <AgentQuestionDialog
        state={
          question?.question
            ? {
                toolCallId: question.question.toolCallId,
                questions: question.question.questions,
              }
            : null
        }
        onAnswer={handleAnswer}
        onPause={() => void handlePause()}
        busy={busy}
      />
      <Toast message={toast} />
    </aside>
  )
}
