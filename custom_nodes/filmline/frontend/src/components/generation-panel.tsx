import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Image as ImageIcon, Loader2, Sparkles, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ApiError, api, type Project } from '@/lib/api'
import { emitAssetsChanged } from '@/lib/events'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

type Mode = 'image' | 'video'

const IMAGE_SIZES = [
  { value: '16:9', label: '横屏 16:9' },
  { value: '9:16', label: '竖屏 9:16' },
  { value: '1:1', label: '方形 1:1' },
] as const

const VIDEO_SIZES = [
  { value: '16:9', label: '横屏 16:9' },
  { value: '9:16', label: '竖屏 9:16' },
] as const

const COUNTS = [1, 2, 3, 4]
const DURATIONS = [5, 10]

interface GenerationPanelProps {
  project: Project
  /** 为空表示项目级 */
  episodeCode?: string
}

export function GenerationPanel({ project, episodeCode }: GenerationPanelProps) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('image')
  const [prompt, setPrompt] = useState('')
  const [imageSize, setImageSize] = useState<string>('16:9')
  const [videoSize, setVideoSize] = useState<string>('16:9')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault()
    if (!prompt.trim() || running) return

    setRunning(true)
    setError(null)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((value) => value + 1), 1000)

    const base = episodeCode
      ? `/projects/${project.code}/episodes/${episodeCode}/assets`
      : `/projects/${project.code}/assets`

    try {
      await api.projects.generate(
        project.code,
        mode === 'image'
          ? { kind: 'image', prompt: prompt.trim(), size: imageSize, count }
          : { kind: 'video', prompt: prompt.trim(), size: videoSize, duration },
        episodeCode,
      )
      setPrompt('')
      emitAssetsChanged()
      navigate(`${base}/${mode}`)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.fullMessage : '生成失败')
    } finally {
      if (timerRef.current) window.clearInterval(timerRef.current)
      timerRef.current = null
      setRunning(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    // 视频没有方形，切过去时自动换成横屏
    if (next === 'video' && videoSize !== '16:9' && videoSize !== '9:16') setVideoSize('16:9')
  }

  return (
    <aside className="flex min-w-0 flex-1 flex-col border-l border-border">
      <div className="flex flex-1 items-center justify-center px-6">
        <form onSubmit={handleSubmit} className="w-full max-w-2xl">
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              value={prompt}
              rows={3}
              placeholder={mode === 'image' ? '描述画面' : '描述镜头'}
              aria-label="提示词"
              disabled={running}
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 disabled:opacity-60"
              onKeyDown={onKeyDown}
              onChange={(event) => setPrompt(event.target.value)}
            />

            <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
              <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-label="生成类型">
                <ModeButton active={mode === 'image'} onClick={() => switchMode('image')}>
                  <ImageIcon className="size-3.5" />
                  图片
                </ModeButton>
                <ModeButton active={mode === 'video'} onClick={() => switchMode('video')}>
                  <Video className="size-3.5" />
                  视频
                </ModeButton>
              </div>

              <CompactSelect
                aria-label="尺寸"
                value={mode === 'image' ? imageSize : videoSize}
                options={mode === 'image' ? IMAGE_SIZES : VIDEO_SIZES}
                onChange={(value) => (mode === 'image' ? setImageSize(value) : setVideoSize(value))}
              />

              {mode === 'image' ? (
                <CompactSelect
                  aria-label="生成数量"
                  value={String(count)}
                  options={COUNTS.map((value) => ({ value: String(value), label: `${value} 张` }))}
                  onChange={(value) => setCount(Number(value))}
                />
              ) : (
                <CompactSelect
                  aria-label="视频时长"
                  value={String(duration)}
                  options={DURATIONS.map((value) => ({ value: String(value), label: `${value} 秒` }))}
                  onChange={(value) => setDuration(Number(value))}
                />
              )}

              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{elapsed}s</span>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="rounded-lg"
                  disabled={running || !prompt.trim()}
                >
                  {running ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      生成中
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3.5" />
                      生成
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {error ? (
            <p className="mt-2 px-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </aside>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function CompactSelect({
  value,
  options,
  onChange,
  ...props
}: {
  value: string
  options: readonly { value: string; label: string }[]
  onChange: (value: string) => void
} & { 'aria-label': string }) {
  return (
    <select
      {...props}
      value={value}
      className="h-7 cursor-pointer rounded-lg border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
