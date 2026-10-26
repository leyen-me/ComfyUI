import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Image as ImageIcon,
  ListTodo,
  Loader2,
  Square,
  Video,
  XCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { api, type TaskInfo } from '@/lib/api'
import { readClientName, saveClientName } from '@/lib/client-name'
import { emitAssetsChanged } from '@/lib/events'
import { formatClock } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Popover } from './ui/popover'

const ACTIVE = new Set(['queued', 'running'])

const STATUS_LABEL: Record<TaskInfo['status'], string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

/** 全局任务队列：固定在右上角，刷新页面/换项目/同事打开都能看到同一批任务。 */
export function TaskQueue() {
  const navigate = useNavigate()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<TaskInfo[]>([])
  const [active, setActive] = useState(0)
  const [failed, setFailed] = useState(false)
  const [cancelling, setCancelling] = useState<Set<number>>(new Set())
  const [name, setName] = useState(() => readClientName())
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<Set<number>>(new Set())
  const firstLoad = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false

    async function load() {
      try {
        const data = await api.tasks.list({ limit: 30 }, controller.signal)
        if (disposed) return
        setTasks(data.items)
        setActive(data.active)
        setFailed(false)
      } catch {
        if (!disposed) setFailed(true)
      }
    }

    void load()
    const poll = window.setInterval(() => void load(), 3000)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      disposed = true
      controller.abort()
      window.clearInterval(poll)
      window.clearInterval(tick)
    }
  }, [])

  // 新任务完成时刷新资产列表；首次加载不触发，避免无意义请求
  useEffect(() => {
    let changed = false
    for (const task of tasks) {
      if (task.status === 'succeeded' && task.id !== null && !seen.current.has(task.id)) {
        seen.current.add(task.id)
        changed = true
      }
    }
    if (firstLoad.current) {
      firstLoad.current = false
      return
    }
    if (changed) emitAssetsChanged()
  }, [tasks])

  const activeTasks = tasks.filter((task) => ACTIVE.has(task.status))
  const finishedTasks = tasks.filter((task) => !ACTIVE.has(task.status)).slice(0, 8)

  function openTask(task: TaskInfo) {
    if (task.external || !task.project_code) return
    const tab =
      task.kind === 'video' ? 'video' : task.kind === 'image' ? 'image' : 'text'
    const base = task.episode_code
      ? `/projects/${task.project_code}/episodes/${task.episode_code}/assets`
      : `/projects/${task.project_code}/assets`
    navigate(`${base}/${tab}`)
    setOpen(false)
  }

  async function cancelTask(task: TaskInfo) {
    if (task.id === null) return
    const id = task.id
    setCancelling((previous) => new Set(previous).add(id))
    try {
      const updated = await api.tasks.cancel(id)
      setTasks((previous) => previous.map((item) => (item.id === id ? updated : item)))
      if (ACTIVE.has(task.status)) {
        setActive((previous) => Math.max(0, previous - 1))
      }
    } catch {
      setFailed(true)
    } finally {
      setCancelling((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-label="任务队列"
        aria-expanded={open}
        className={cn(
          'fixed top-3 right-4 z-40 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-elevated px-3 text-xs shadow-[0_1px_2px_rgb(0_0_0/0.1)] transition-colors hover:border-foreground/20 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
          active > 0 && 'border-primary/40',
        )}
        onClick={() => setOpen((value) => !value)}
      >
        <ListTodo className="size-3.5" />
        任务
        {active > 0 ? (
          <span className="flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-4 text-primary-foreground">
            {active}
          </span>
        ) : null}
        {failed && active === 0 ? <span className="size-1.5 rounded-full bg-amber-500" /> : null}
      </button>

      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        width={400}
        align="end"
      >
        <div className="flex items-center justify-between px-1.5 pb-2">
          <span className="text-xs font-medium">任务队列</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {failed ? '队列连接异常' : active > 0 ? `${active} 个进行中` : '当前空闲'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 px-1.5 pb-2">
          <span className="shrink-0 text-[10px] text-muted-foreground">我的昵称</span>
          <input
            value={name}
            maxLength={40}
            aria-label="我的任务昵称"
            title="只影响之后提交的任务"
            className="h-6 min-w-0 flex-1 rounded border border-border bg-input px-1.5 text-[11px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setName(saveClientName(name))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </div>

        <div data-scroll-region className="max-h-[64vh] space-y-2 overflow-y-auto pb-1">
          {tasks.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              当前没有任务
            </p>
          ) : null}

          {activeTasks.length > 0 ? (
            <Section title="进行中">
              {activeTasks.map((task) => (
                <TaskRow
                  key={task.id ?? task.prompt_id ?? 'external'}
                  task={task}
                  now={now}
                  onOpen={() => openTask(task)}
                  onCancel={() => void cancelTask(task)}
                  cancelling={task.id !== null && cancelling.has(task.id)}
                />
              ))}
            </Section>
          ) : null}

          {finishedTasks.length > 0 ? (
            <Section title="最近完成">
              {finishedTasks.map((task) => (
                <TaskRow
                  key={task.id ?? task.prompt_id ?? 'external'}
                  task={task}
                  now={now}
                  onOpen={() => openTask(task)}
                  onCancel={() => void cancelTask(task)}
                  cancelling={task.id !== null && cancelling.has(task.id)}
                />
              ))}
            </Section>
          ) : null}
        </div>
      </Popover>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-1.5 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function TaskRow({
  task,
  now,
  onOpen,
  onCancel,
  cancelling,
}: {
  task: TaskInfo
  now: number
  onOpen: () => void
  onCancel: () => void
  cancelling: boolean
}) {
  const active = ACTIVE.has(task.status)
  const clickable = !task.external && Boolean(task.project_code)
  const elapsed = elapsedSeconds(task, now)
  const effectiveStatus =
    task.status === 'running' && (task.queue_position ?? 0) > 0 ? 'queued' : task.status
  const statusLabel = STATUS_LABEL[effectiveStatus]
  const queueLabel =
    effectiveStatus === 'queued' && task.queue_position
      ? `第 ${task.queue_position} 位`
      : null
  const canCancel = !task.external && task.id !== null && active

  const content = (
    <>
      <span
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md',
          task.status === 'failed'
            ? 'bg-destructive/10 text-destructive'
            : task.status === 'succeeded'
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'bg-accent text-muted-foreground',
        )}
      >
        {task.status === 'failed' ? (
          <XCircle className="size-3.5" />
        ) : task.status === 'succeeded' ? (
          <CheckCircle2 className="size-3.5" />
        ) : active ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Clock className="size-3.5" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="truncate text-xs font-medium">
            {task.external
              ? 'ComfyUI 外部任务'
              : `${task.project_code ?? ''} ${task.project_name}`.trim()}
          </span>
          {task.external ? (
            <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
              外部
            </span>
          ) : null}
          {task.episode_code ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {task.episode_code}
            </span>
          ) : null}
          {task.client_label ? (
            <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
              {task.client_label}
            </span>
          ) : null}
          <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
            {task.kind === 'video' ? (
              <Video className="size-3" />
            ) : task.kind === 'image' ? (
              <ImageIcon className="size-3" />
            ) : null}
            {task.kind === 'video' ? '视频' : task.kind === 'image' ? '图片' : '任务'}
          </span>
        </span>

        {task.prompt_excerpt ? (
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {task.prompt_excerpt}
          </span>
        ) : null}

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
          <span
            className={cn(
              task.status === 'failed' && 'text-destructive',
              task.status === 'succeeded' && 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {statusLabel}
          </span>
          {queueLabel ? <span>{queueLabel}</span> : null}
          {elapsed !== null ? (
            <span>
              {effectiveStatus === 'queued' ? '等待' : task.status === 'running' ? '运行' : '耗时'}{' '}
              {formatClock(elapsed)}
            </span>
          ) : null}
          {task.status === 'succeeded' && task.asset_ids.length > 0 ? (
            <span>{task.asset_ids.length} 个产物</span>
          ) : null}
          {task.error ? (
            <span className="max-w-full truncate text-destructive" title={task.error}>
              {task.error}
            </span>
          ) : null}
        </span>
      </span>
    </>
  )

  return (
    <div className="flex items-start gap-1 rounded-lg transition-colors hover:bg-muted">
      {clickable ? (
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 text-left focus-visible:bg-muted focus-visible:outline-none"
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2 px-1.5 py-1.5">
          {content}
        </div>
      )}

      {canCancel ? (
        <button
          type="button"
          aria-label={`取消任务 ${task.id}`}
          title="取消任务"
          disabled={cancelling}
          className="mt-1 mr-1 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
          onClick={onCancel}
        >
          {cancelling ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Square className="size-3.5" />
          )}
        </button>
      ) : clickable ? (
        <ArrowUpRight className="mt-2 mr-1 size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
    </div>
  )
}

function elapsedSeconds(task: TaskInfo, now: number): number | null {
  if (task.elapsed_ms !== null) return Math.max(0, Math.round(task.elapsed_ms / 1000))
  if (!ACTIVE.has(task.status)) {
    if (task.started_at && task.finished_at) {
      return Math.max(
        0,
        Math.round((Date.parse(task.finished_at) - Date.parse(task.started_at)) / 1000),
      )
    }
    return null
  }
  const start = task.started_at ?? task.created_at
  if (!start) return null
  return Math.max(0, Math.floor((now - Date.parse(start)) / 1000))
}
