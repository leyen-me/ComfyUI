import { useEffect, useState } from 'react'
import {
  AudioLines,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ListTree,
  Loader2,
  Music,
  Play,
  Video,
  XCircle,
} from 'lucide-react'

import { ApiError, api, type Asset, type TaskInfo, type TaskStatus } from '@/lib/api'
import type { ToolView } from '@/lib/agent-view'
import { copyText } from '@/lib/clipboard'
import { formatSeconds, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Dialog } from './ui/dialog'
import { VideoThumb } from './video-thumb'

interface Envelope {
  ok?: boolean
  summary?: string
  data?: Record<string, unknown>
  error?: { message?: string }
}

function parse(tool: ToolView): Envelope | null {
  if (!tool.resultRaw) return null
  try {
    const value = JSON.parse(tool.resultRaw) as Envelope
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function str(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key]
  return typeof value === 'string' ? value : ''
}

function num(data: Record<string, unknown> | undefined, key: string): number | null {
  const value = data?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function assetUrl(data: Record<string, unknown> | undefined, key = 'preview_url'): string {
  const direct = str(data, key)
  if (direct) return direct
  const id = num(data, 'asset_id') ?? num(data, 'id')
  return id ? `/studio/api/assets/${id}/content` : ''
}

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Lightbox({
  item,
  onClose,
}: {
  item: { src: string; title: string; kind: 'image' | 'video' | 'audio' } | null
  onClose: () => void
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [item?.src])

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={item?.title ?? '预览'}
      className="sm:w-[min(1100px,94vw)]"
      mobileFullHeight
      footer={
        item ? (
          <a
            href={item.src}
            target="_blank"
            rel="noopener noreferrer"
            className="mr-auto text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            在新标签页打开
          </a>
        ) : null
      }
    >
      {item ? (
        <div className="pb-3 sm:max-h-[72vh] sm:overflow-y-auto">
          {failed ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
              素材不可用，可能已被删除或文件已移动。
            </p>
          ) : item.kind === 'image' ? (
            <div className="-mx-2 flex justify-center sm:mx-0">
              <img
                src={item.src}
                alt={item.title}
                onError={() => setFailed(true)}
                className="max-h-[calc(100dvh-11rem)] w-auto max-w-full rounded-lg bg-black/30 object-contain sm:max-h-[66vh]"
              />
            </div>
          ) : item.kind === 'video' ? (
            <div className="-mx-2 flex justify-center sm:mx-0">
              <video
                src={item.src}
                controls
                autoPlay
                playsInline
                onError={() => setFailed(true)}
                className="max-h-[calc(100dvh-11rem)] w-full rounded-lg bg-black object-contain sm:max-h-[66vh]"
              />
            </div>
          ) : (
            <audio
              src={item.src}
              controls
              autoPlay
              onError={() => setFailed(true)}
              className="w-full"
            />
          )}
        </div>
      ) : null}
    </Dialog>
  )
}

function Thumb({
  item,
  onOpen,
  className,
}: {
  item: { src: string; title: string; kind: 'image' | 'video' | 'audio' }
  onOpen: () => void
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [item.src])

  return (
    <button
      type="button"
      onClick={onOpen}
      title={failed ? `${item.title}（素材不可用或已删除）` : item.title}
      className={cn(
        'group relative block cursor-zoom-in overflow-hidden rounded-lg border border-border bg-muted/40 transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
        className ?? 'size-20',
      )}
    >
      {failed ? (
        <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center text-[9px] leading-tight text-muted-foreground">
          <ImageIcon className="size-4 opacity-60" />
          已删除/不可用
        </span>
      ) : item.kind === 'video' ? (
        <VideoThumb src={item.src} className="size-full" onError={() => setFailed(true)} />
      ) : item.kind === 'image' ? (
        <img
          src={item.src}
          alt={item.title}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <Music className="size-6" />
        </span>
      )}
      {item.kind === 'video' && !failed ? (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/65 p-0.5 text-white">
          <Play className="size-2.5 fill-current" />
        </span>
      ) : null}
    </button>
  )
}

const ACTIVE_TASK = new Set<TaskStatus>(['queued', 'running'])

function normalizeTask(data: Record<string, unknown> | undefined): TaskInfo | null {
  const id = num(data, 'task_id') ?? num(data, 'id')
  if (!id) return null
  const status = (str(data, 'status') || 'queued') as TaskStatus
  return {
    id,
    client_id: str(data, 'client_id'),
    prompt_id: str(data, 'prompt_id') || null,
    project_id: null,
    project_code: str(data, 'project') || null,
    project_name: '',
    episode_id: null,
    episode_code: str(data, 'episode') || null,
    kind: (str(data, 'kind') || 'image') as TaskInfo['kind'],
    status,
    prompt_excerpt: str(data, 'prompt_excerpt'),
    client_label: '',
    created_at: str(data, 'created_at') || null,
    started_at: str(data, 'started_at') || null,
    finished_at: str(data, 'finished_at') || null,
    elapsed_ms: num(data, 'elapsed_ms'),
    error: str(data, 'error') || null,
    asset_ids: Array.isArray(data?.asset_ids)
      ? (data.asset_ids as unknown[]).filter((value): value is number => typeof value === 'number')
      : [],
    queue_position: null,
    external: false,
    progress:
      data?.progress && typeof data.progress === 'object'
        ? (data.progress as TaskInfo['progress'])
        : null,
  }
}

const STATUS_TEXT: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function TaskMiniCard({ initial }: { initial: TaskInfo }) {
  const [task, setTask] = useState(initial)
  const [assets, setAssets] = useState<Asset[]>([])
  const [missing, setMissing] = useState(false)
  const [lightbox, setLightbox] = useState<{
    src: string
    title: string
    kind: 'image' | 'video'
  } | null>(null)
  const assetKey = task.asset_ids.join(',')
  const active = ACTIVE_TASK.has(task.status)

  useEffect(() => {
    if (!task.id || !active || missing) return
    let disposed = false
    const timer = window.setInterval(() => {
      void api.tasks
        .get(task.id as number)
        .then((next) => {
          if (!disposed) setTask(next)
        })
        .catch((cause) => {
          if (!disposed && cause instanceof ApiError && cause.status === 404) {
            setMissing(true)
          }
        })
    }, 3000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [task.id, active, missing])

  useEffect(() => {
    if (!assetKey) {
      setAssets([])
      return
    }
    let disposed = false
    const ids = assetKey.split(',').map(Number).filter((value) => value > 0).slice(0, 4)
    void Promise.all(
      ids.map((id) => api.projects.assets.get(id).catch(() => null)),
    ).then((items) => {
      if (!disposed) setAssets(items.filter((item): item is Asset => item !== null))
    })
    return () => {
      disposed = true
    }
  }, [assetKey])

  const percent = task.progress?.percent ?? null
  const stage = task.progress?.stage || (task.status === 'queued' ? '排队中' : '生成中')

  if (missing) {
    return (
      <div className="mt-1.5 rounded-lg border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">
        任务 #{task.id} · 任务记录已被清理，无法继续查询进度；如果产物还在，左侧资产列表仍可查看。
      </div>
    )
  }

  return (
    <div className="mt-1.5 rounded-lg border border-border bg-card/70 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          {task.kind === 'video' ? <Video className="size-3" /> : <ImageIcon className="size-3" />}
          任务 #{task.id}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 py-0.5',
            task.status === 'failed'
              ? 'bg-destructive/10 text-destructive'
              : task.status === 'succeeded'
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-primary/10 text-primary',
          )}
        >
          {active ? (
            <Loader2 className="size-2.5 animate-spin" />
          ) : task.status === 'succeeded' ? (
            <CheckCircle2 className="size-2.5" />
          ) : task.status === 'failed' ? (
            <XCircle className="size-2.5" />
          ) : (
            <Clock className="size-2.5" />
          )}
          {STATUS_TEXT[task.status]}
        </span>
        {task.elapsed_ms ? (
          <span className="text-muted-foreground">{formatSeconds(task.elapsed_ms / 1000)}</span>
        ) : null}
        {task.episode_code ? (
          <span className="text-muted-foreground">{task.episode_code}</span>
        ) : null}
      </div>

      {active ? (
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${percent ?? 8}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {percent !== null ? `${percent}%` : stage}
          </span>
        </div>
      ) : null}

      {task.prompt_excerpt ? (
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {task.prompt_excerpt}
        </p>
      ) : null}

      {task.error ? (
        <p className="mt-1 text-[11px] text-destructive">{task.error}</p>
      ) : null}

      {assets.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {assets.map((asset) => {
            if (!asset.content_url) return null
            return (
              <Thumb
                key={asset.id}
                item={{
                  src: asset.content_url,
                  title: asset.name,
                  kind: asset.kind === 'video' ? 'video' : 'image',
                }}
                onOpen={() =>
                  setLightbox({
                    src: asset.content_url as string,
                    title: asset.name,
                    kind: asset.kind === 'video' ? 'video' : 'image',
                  })
                }
                className="h-16 w-20"
              />
            )
          })}
        </div>
      ) : null}

      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function TaskListCard({ tasks }: { tasks: TaskInfo[] }) {
  if (!tasks.length) return null
  return (
    <div className="space-y-1">
      {tasks.slice(0, 4).map((task) => (
        <TaskMiniCard key={task.id} initial={task} />
      ))}
    </div>
  )
}

function MediaCard({ tool, envelope }: { tool: ToolView; envelope: Envelope }) {
  const data = envelope.data
  const assetId = num(data, 'asset_id') ?? num(data, 'id')
  const previewUrl = str(data, 'preview_url') || str(data, 'content_url') || assetUrl(data)
  const kind = str(data, 'kind') || (tool.name === 'read_video' ? 'video' : 'image')
  const preview = tool.preview ?? (kind === 'video' ? '' : previewUrl)
  const name = str(data, 'name') || str(data, 'title') || '素材'
  const timestamps = Array.isArray(data?.timestamps)
    ? (data.timestamps as unknown[]).filter((value): value is number => typeof value === 'number')
    : []
  const [lightbox, setLightbox] = useState<{
    src: string
    title: string
    kind: 'image' | 'video' | 'audio'
  } | null>(null)

  if (!preview && !previewUrl) return null
  const lightboxItem =
    kind === 'video'
      ? {
          src: previewUrl || preview,
          title: `${name}（视频）`,
          kind: 'video' as const,
        }
      : { src: previewUrl || preview, title: name, kind: 'image' as const }

  return (
    <div className="mt-1.5 flex items-start gap-2.5">
      <Thumb
        item={{
          src: preview || previewUrl,
          title: name,
          kind: kind === 'video' ? 'video' : 'image',
        }}
        onOpen={() => setLightbox(lightboxItem)}
        className="h-20 w-28 shrink-0"
      />
      <div className="min-w-0 flex-1 pt-0.5 text-[11px] text-muted-foreground">
        <p className="truncate font-medium text-foreground">{name}</p>
        {assetId ? <p className="font-mono text-[10px]">#{assetId}</p> : null}
        {tool.name === 'read_video' ? (
          <p>
            {num(data, 'duration')?.toFixed(2)}s · {num(data, 'width')}×{num(data, 'height')}
            {num(data, 'fps') ? ` · ${num(data, 'fps')}fps` : ''}
          </p>
        ) : null}
        {timestamps.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {timestamps.map((stamp) => (
              <span
                key={stamp}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[9.5px]"
              >
                {stamp.toFixed(1)}s
              </span>
            ))}
          </div>
        ) : null}
        {num(data, 'at_seconds') !== null ? (
          <p className="mt-0.5">抽帧位置 {num(data, 'at_seconds')?.toFixed(2)}s</p>
        ) : null}
      </div>
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function AudioCard({ envelope }: { envelope: Envelope }) {
  const data = envelope.data
  const src = str(data, 'content_url') || assetUrl(data)
  const name = str(data, 'name') || '音频'
  const [failed, setFailed] = useState(false)
  const meta = `${formatSeconds(num(data, 'duration') ?? 0)} · ${num(data, 'sample_rate') ?? '?'}Hz · ${num(data, 'channels') ?? '?'} 声道`
  if (!src || failed) {
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        {name} · {meta}
        {failed ? ' · 音频已删除或不可用' : ''}
      </p>
    )
  }
  return (
    <div className="mt-1.5 rounded-lg border border-border bg-card/70 p-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <AudioLines className="size-3 text-primary" />
        <span className="truncate text-foreground">{name}</span>
        <span className="ml-auto font-mono">{meta}</span>
      </div>
      <audio
        src={src}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="h-8 w-full"
      />
    </div>
  )
}

function MediaInfoCard({ envelope }: { envelope: Envelope }) {
  const data = envelope.data
  const kind = str(data, 'kind') || 'image'
  const src = str(data, 'content_url') || assetUrl(data)
  const name = str(data, 'name') || '媒体'
  const [lightbox, setLightbox] = useState<{
    src: string
    title: string
    kind: 'image' | 'video' | 'audio'
  } | null>(null)
  return (
    <div className="mt-1.5 rounded-lg border border-border bg-card/70 p-2 text-[11px]">
      <div className="flex items-start gap-2">
        {src && kind !== 'audio' ? (
          <Thumb
            item={{ src, title: name, kind: kind === 'video' ? 'video' : 'image' }}
            onOpen={() =>
              setLightbox({
                src,
                title: name,
                kind: kind === 'video' ? 'video' : 'image',
              })
            }
            className="h-16 w-20 shrink-0"
          />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {kind === 'audio' ? <Music className="size-4" /> : <FileText className="size-4" />}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{name}</p>
          <p className="mt-0.5 text-muted-foreground">
            {num(data, 'width') && num(data, 'height')
              ? `${num(data, 'width')}×${num(data, 'height')} · `
              : ''}
            {num(data, 'duration') ? `${num(data, 'duration')?.toFixed(2)}s` : ''}
            {num(data, 'fps') ? ` · ${num(data, 'fps')}fps` : ''}
            {data?.has_audio ? ' · 有音轨' : ''}
          </p>
        </div>
      </div>
      {src && kind === 'audio' ? (
        <audio src={src} controls preload="metadata" className="mt-1.5 h-8 w-full" />
      ) : null}
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function assetKind(kind: unknown): 'image' | 'video' | 'audio' | 'text' {
  return kind === 'video' || kind === 'audio' || kind === 'text' ? kind : 'image'
}

function AssetGridCard({ envelope }: { envelope: Envelope }) {
  const items = Array.isArray(envelope.data?.items) ? envelope.data.items : []
  const [lightbox, setLightbox] = useState<{
    src: string
    title: string
    kind: 'image' | 'video' | 'audio'
  } | null>(null)
  const usable = items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 8)
  if (!usable.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {usable.map((item) => {
        const kind = assetKind(item.kind)
        const src = str(item, 'content_url') || assetUrl(item)
        const name = str(item, 'name')
        if (!src) {
          return (
            <span
              key={`${str(item, 'id')}-${name}`}
              className="flex h-14 w-20 items-center justify-center rounded-lg border border-border bg-muted/40 text-[10px] text-muted-foreground"
              title={name}
            >
              <FileText className="mr-1 size-3" />
              {kind}
            </span>
          )
        }
        return (
          <Thumb
            key={`${str(item, 'id')}-${name}`}
            item={{
              src,
              title: `${name}${kind === 'text' ? '（文本）' : ''}`,
              kind: kind === 'video' || kind === 'audio' ? kind : 'image',
            }}
            onOpen={() => setLightbox({ src, title: name, kind: kind === 'video' ? 'video' : 'image' })}
            className="h-14 w-20"
          />
        )
      })}
      <Lightbox item={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

function WebSearchCard({ envelope }: { envelope: Envelope }) {
  const results = Array.isArray(envelope.data?.results) ? envelope.data.results : []
  const usable = results
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 5)
  if (!usable.length) return null
  return (
    <div className="mt-1.5 divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card/60">
      {usable.map((item, index) => {
        const url = str(item, 'url')
        return (
          <a
            key={`${url}-${index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-2.5 py-2 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="truncate">{str(item, 'site_name') || domain(url)}</span>
              {str(item, 'date') ? <span>· {formatTime(str(item, 'date')).slice(0, 10)}</span> : null}
              {num(item, 'authority') && Number(item.authority) >= 3 ? (
                <span className="rounded bg-emerald-500/10 px-1 text-emerald-600 dark:text-emerald-400">
                  权威
                </span>
              ) : null}
              <ExternalLink className="ml-auto size-2.5 shrink-0" />
            </div>
            <p className="mt-0.5 line-clamp-1 text-[12px] font-medium text-foreground">
              {str(item, 'title') || url}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
              {str(item, 'summary') || str(item, 'snippet')}
            </p>
          </a>
        )
      })}
    </div>
  )
}

function WebFetchCard({ envelope }: { envelope: Envelope }) {
  const data = envelope.data
  const url = str(data, 'url')
  const title = str(data, 'title') || domain(url)
  const content = str(data, 'content').replace(/\s+/g, ' ').trim()
  if (!url) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 block rounded-lg border border-border bg-card/60 px-2.5 py-2 transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="truncate">{domain(url)}</span>
        <span>· {num(data, 'chars') ?? 0} 字符</span>
        {data?.truncated ? <span>· 已截断</span> : null}
        <ExternalLink className="ml-auto size-2.5 shrink-0" />
      </div>
      <p className="mt-0.5 line-clamp-1 text-[12px] font-medium text-foreground">{title}</p>
      <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-muted-foreground">
        {content}
      </p>
    </a>
  )
}

function TextCard({ envelope }: { envelope: Envelope }) {
  const data = envelope.data
  const name = str(data, 'name') || '文本'
  const content = str(data, 'content') || str(data, 'text_preview')
  const total = num(data, 'total_chars') ?? num(data, 'text_length') ?? content.length
  const nextOffset = num(data, 'next_offset')
  const [copied, setCopied] = useState(false)

  if (!content && !name) return null

  return (
    <div className="mt-1.5 rounded-lg border border-border bg-card/70 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        <FileText className="size-3 text-primary" />
        <span className="truncate font-medium text-foreground">{name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {total} 字符
        </span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(content)) {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }
          }}
          title="复制文本"
          className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        </button>
      </div>
      {content ? (
        <pre className="mt-1.5 max-h-32 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap break-words text-foreground/85">
          {content.slice(0, 1500)}
          {content.length > 1500 ? '\n…' : ''}
        </pre>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">空文本</p>
      )}
      {nextOffset !== null ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          已显示到 {nextOffset} 字符，可继续分段读取
        </p>
      ) : null}
    </div>
  )
}

function WorkspaceCard({ envelope }: { envelope: Envelope }) {
  const data = envelope.data
  const project =
    data?.project && typeof data.project === 'object'
      ? (data.project as Record<string, unknown>)
      : {}
  const episodes = Array.isArray(data?.episodes) ? data.episodes : []
  const counts =
    data?.asset_counts && typeof data.asset_counts === 'object'
      ? (data.asset_counts as Record<string, unknown>)
      : {}
  const tasks = Array.isArray(data?.active_tasks) ? data.active_tasks : []
  const code = str(project, 'code')
  const name = str(project, 'name') || '当前项目'

  return (
    <div className="mt-1.5 rounded-lg border border-border bg-card/70 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <BookOpen className="size-3 text-primary" />
        {code ? (
          <a
            href={`/studio/projects/${code}`}
            className="truncate font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
          >
            {name}
          </a>
        ) : (
          <span className="truncate font-medium text-foreground">{name}</span>
        )}
        {code ? <span className="font-mono text-[10px] text-muted-foreground">{code}</span> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {(['text', 'image', 'video', 'audio'] as const).map((kind) => (
          <span
            key={kind}
            className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {kind} {String(counts[kind] ?? 0)}
          </span>
        ))}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          分集 {episodes.length}
        </span>
      </div>
      {episodes.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {episodes.slice(0, 6).map((item) => {
            if (!item || typeof item !== 'object') return null
            const episode = item as Record<string, unknown>
            return (
              <span
                key={str(episode, 'code')}
                className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                <span className="font-mono text-primary">{str(episode, 'code')}</span>{' '}
                {str(episode, 'title')}
              </span>
            )
          })}
        </div>
      ) : null}
      {tasks.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tasks.slice(0, 4).map((item) => {
            if (!item || typeof item !== 'object') return null
            const task = item as Record<string, unknown>
            return (
              <span
                key={String(task.id)}
                className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
              >
                任务 #{String(task.id)} · {str(task, 'status')}
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function EpisodesCard({
  envelope,
  projectCode,
}: {
  envelope: Envelope
  projectCode: string
}) {
  const episodes = Array.isArray(envelope.data?.episodes) ? envelope.data.episodes : []
  if (!episodes.length) return null
  return (
    <div className="mt-1.5 divide-y divide-border/60 overflow-hidden rounded-lg border border-border bg-card/60">
      {episodes.slice(0, 8).map((item) => {
        if (!item || typeof item !== 'object') return null
        const episode = item as Record<string, unknown>
        const code = str(episode, 'code')
        return (
          <a
            key={code}
            href={`/studio/projects/${projectCode}/episodes/${code}/assets/text`}
            className="flex items-start gap-2 px-2.5 py-2 transition-colors hover:bg-muted/50"
          >
            <ListTree className="mt-0.5 size-3 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="font-mono text-[10px] text-primary">{code}</span>
                <span className="truncate text-[11.5px] text-foreground">
                  {str(episode, 'title')}
                </span>
              </span>
              {str(episode, 'synopsis') ? (
                <span className="mt-0.5 line-clamp-1 block text-[10px] text-muted-foreground">
                  {str(episode, 'synopsis')}
                </span>
              ) : null}
            </span>
            <FolderOpen className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          </a>
        )
      })}
    </div>
  )
}

export function AgentToolCard({
  tool,
  projectCode,
}: {
  tool: ToolView
  projectCode: string
}) {
  const envelope = parse(tool)
  if (!envelope || envelope.ok === false || !envelope.data) return null

  if (tool.name === 'get_workspace_context') return <WorkspaceCard envelope={envelope} />
  if (tool.name === 'list_episodes') {
    return <EpisodesCard envelope={envelope} projectCode={projectCode} />
  }
  if (
    ['read_text_asset', 'read_file', 'create_text_asset', 'update_text_asset'].includes(tool.name)
  ) {
    return <TextCard envelope={envelope} />
  }

  const mediaNames = new Set(['read_image', 'read_video', 'extract_frame'])
  const probeNames = new Set(['probe_media', 'get_asset'])

  if (mediaNames.has(tool.name)) return <MediaCard tool={tool} envelope={envelope} />
  if (probeNames.has(tool.name)) {
    const kind = str(envelope.data, 'kind')
    if (kind === 'text') return <TextCard envelope={envelope} />
    return kind === 'audio' ? <AudioCard envelope={envelope} /> : <MediaInfoCard envelope={envelope} />
  }
  if (tool.name === 'read_audio') return <AudioCard envelope={envelope} />
  if (tool.name === 'list_assets') return <AssetGridCard envelope={envelope} />
  if (tool.name === 'web_search') return <WebSearchCard envelope={envelope} />
  if (tool.name === 'web_fetch') return <WebFetchCard envelope={envelope} />

  if (
    ['create_image', 'create_video', 'get_generation_task', 'cancel_generation_task'].includes(
      tool.name,
    )
  ) {
    const task = normalizeTask(envelope.data)
    return task ? <TaskMiniCard initial={task} /> : null
  }
  if (tool.name === 'list_generation_tasks') {
    const tasks = Array.isArray(envelope.data.items)
      ? envelope.data.items
          .map((item) =>
            normalizeTask(
              item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined,
            ),
          )
          .filter((item): item is TaskInfo => item !== null)
      : []
    return <TaskListCard tasks={tasks} />
  }
  if (tool.name === 'wait_generation') {
    const tasks = Array.isArray(envelope.data.tasks)
      ? envelope.data.tasks
          .map((item) =>
            normalizeTask(
              item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined,
            ),
          )
          .filter((item): item is TaskInfo => item !== null)
      : []
    return <TaskListCard tasks={tasks} />
  }
  return null
}
