import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, Loader2, Sparkles, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ApiError, api, type Project } from '@/lib/api'
import { buildPromptDoc, type RefAsset } from '@/lib/prompt'
import { emitAssetsChanged, REUSE_PROMPT, type ReusePromptDetail } from '@/lib/events'
import { cn } from '@/lib/utils'
import { formatClock } from '@/lib/format'
import { GenerationOptions } from './generation-options'
import { PromptInput, type PromptInputHandle } from './prompt-input'
import type { PromptValue } from './prompt-editor'
import { Button } from './ui/button'

type Mode = 'image' | 'video'

const COUNTS = [1, 2, 3, 4]
const DURATIONS = [5, 10]
const EMPTY_VALUE: PromptValue = { text: '', refs: [] }

interface GenerationPanelProps {
  project: Project
  /** 为空表示项目级 */
  episodeCode?: string
}

export function GenerationPanel({ project, episodeCode }: GenerationPanelProps) {
  const navigate = useNavigate()
  const editorRef = useRef<PromptInputHandle>(null)

  const [mode, setMode] = useState<Mode>('image')
  const [value, setValue] = useState<PromptValue>(EMPTY_VALUE)
  const [imageSize, setImageSize] = useState<string>('16:9')
  const [imageTier, setImageTier] = useState<string>('1k')
  const [videoSize, setVideoSize] = useState<string>('16:9')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState(5)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<number | null>(null)
  const hasRefs = value.refs.length > 0
  const maxRefs = mode === 'image' ? 16 : 1

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  // 资产预览里点“用此提示词生成”：回填模式与参数
  useEffect(() => {
    async function onReuse(event: Event) {
      const detail = (event as CustomEvent<ReusePromptDetail>).detail
      if (detail.kind === 'video') {
        setMode('video')
        if (detail.size === '16:9' || detail.size === '9:16') setVideoSize(detail.size)
        if (detail.duration === 5 || detail.duration === 10) setDuration(detail.duration)
      } else {
        setMode('image')
        if (detail.size === '16:9' || detail.size === '9:16' || detail.size === '1:1') {
          setImageSize(detail.size)
        }
        if (detail.tier === '1k' || detail.tier === '2k') setImageTier(detail.tier)
        if (typeof detail.count === 'number' && detail.count >= 1 && detail.count <= 4) {
          setCount(detail.count)
        }
      }
      const refIds = detail.refIds ?? []
      if (refIds.length > 0) {
        // 还原参考图块；已被删除的资产保留为普通文字「图N」
        const loaded = await Promise.all(
          refIds.map((assetId) => api.projects.assets.get(assetId).catch(() => null)),
        )
        const refs: Array<RefAsset | null> = loaded.map((asset) =>
          asset ? { assetId: asset.id, src: asset.content_url ?? '' } : null,
        )
        editorRef.current?.setDoc(buildPromptDoc(detail.prompt, refs))
      } else {
        editorRef.current?.setText(detail.prompt)
      }
      editorRef.current?.focus()
    }
    window.addEventListener(REUSE_PROMPT, onReuse)
    return () => window.removeEventListener(REUSE_PROMPT, onReuse)
  }, [])

  async function handleSubmit() {
    if (running) return
    const current = editorRef.current?.getValue() ?? value
    if (!current.text.trim()) return

    setRunning(true)
    setError(null)
    setElapsed(0)
    timerRef.current = window.setInterval(() => setElapsed((previous) => previous + 1), 1000)

    const base = episodeCode
      ? `/projects/${project.code}/episodes/${episodeCode}/assets`
      : `/projects/${project.code}/assets`

    try {
      await api.projects.generate(
        project.code,
        mode === 'image'
          ? {
              kind: 'image',
              prompt: current.text,
              size: imageSize,
              resolution: imageTier,
              count: hasRefs ? 1 : count,
              refs: current.refs,
            }
          : {
              kind: 'video',
              prompt: current.text,
              size: videoSize,
              duration,
              refs: current.refs,
            },
        episodeCode,
      )
      editorRef.current?.clear()
      setValue(EMPTY_VALUE)
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

  function switchMode(next: Mode) {
    setMode(next)
    if (next === 'video' && videoSize !== '16:9' && videoSize !== '9:16') setVideoSize('16:9')
  }

  return (
    <aside className="flex min-w-0 flex-1 flex-col border-l border-border">
      <div className="flex flex-1 items-center justify-center px-6">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSubmit()
          }}
          className="w-full max-w-2xl"
        >
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <PromptInput
              ref={editorRef}
              disabled={running}
              maxRefs={maxRefs}
              placeholder={
                mode === 'image'
                  ? '描述画面，可把左侧图片拖进来'
                  : '描述镜头、运镜与声音（对白 / 音效 / 配乐），可拖入一张首帧图'
              }
              onChange={setValue}
              onSubmit={() => void handleSubmit()}
              onReject={setError}
            />

            <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
              <div
                className="flex overflow-hidden rounded-lg border border-border"
                role="group"
                aria-label="生成类型"
              >
                <ModeButton active={mode === 'image'} onClick={() => switchMode('image')}>
                  <ImageIcon className="size-3.5" />
                  图片
                </ModeButton>
                <ModeButton active={mode === 'video'} onClick={() => switchMode('video')}>
                  <Video className="size-3.5" />
                  视频
                </ModeButton>
              </div>

              <GenerationOptions
                mode={mode}
                size={mode === 'image' ? imageSize : videoSize}
                tier={mode === 'image' ? imageTier : '768'}
                onSizeChange={(next) =>
                  mode === 'image' ? setImageSize(next) : setVideoSize(next)
                }
                onTierChange={setImageTier}
              />

              {mode === 'image' ? (
                <CompactSelect
                  aria-label="生成数量"
                  value={String(count)}
                  options={COUNTS.map((item) => ({ value: String(item), label: `${item} 张` }))}
                  disabled={hasRefs}
                  onChange={(next) => setCount(Number(next))}
                />
              ) : (
                <CompactSelect
                  aria-label="视频时长"
                  value={String(duration)}
                  options={DURATIONS.map((item) => ({
                    value: String(item),
                    label: `${item} 秒`,
                  }))}
                  onChange={(next) => setDuration(Number(next))}
                />
              )}

              {hasRefs ? (
                <span className="text-[11px] text-muted-foreground">
                  已引用 {value.refs.length} 张，按所选比例居中裁切
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatClock(elapsed)}
                  </span>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="rounded-lg"
                  disabled={running || !value.text.trim()}
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
} & { 'aria-label': string; disabled?: boolean }) {
  return (
    <select
      {...props}
      value={value}
      className="h-7 cursor-pointer rounded-lg border border-border bg-input px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50"
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
