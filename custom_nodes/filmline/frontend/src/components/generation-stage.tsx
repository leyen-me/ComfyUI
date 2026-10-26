import { useCallback, useEffect, useState } from 'react'
import { Image as ImageIcon, Loader2, Sparkles, Video } from 'lucide-react'

import { api, type Asset } from '@/lib/api'
import { assetPrompt } from '@/lib/asset-meta'
import { copyText } from '@/lib/clipboard'
import { ASSETS_CHANGED, emitReusePrompt } from '@/lib/events'
import { formatClock, formatRelative } from '@/lib/format'
import { reuseDetailFor } from '@/lib/reuse'
import { cn } from '@/lib/utils'
import { startAssetDrag } from './asset-list'
import { AssetPreview } from './asset-preview'
import { VideoThumb } from './video-thumb'

/** 舞台上最多展示的近期产物，够回看即可，完整列表在左侧资产面板。 */
const RECENT_LIMIT = 24

interface GenerationStageProps {
  projectRef: string
  episodeCode?: string
  running: boolean
  runningKind: 'image' | 'video'
  elapsed: number
}

/**
 * 生成面板上方的「舞台」：按时间倒序展示当前作用域内的 AI 产物，
 * 让每次生成都有即时反馈，并可直接拖回提示词区或首尾帧继续迭代。
 */
export function GenerationStage({
  projectRef,
  episodeCode,
  running,
  runningKind,
  elapsed,
}: GenerationStageProps) {
  const [items, setItems] = useState<Asset[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [token, setToken] = useState(0)
  const [preview, setPreview] = useState<Asset | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    api.projects.assets
      .list(projectRef, {
        source: 'ai',
        limit: RECENT_LIMIT,
        episode: episodeCode,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) return
        setItems(result.items.filter((item) => item.kind === 'image' || item.kind === 'video'))
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [projectRef, episodeCode, token])

  useEffect(() => {
    const refresh = () => setToken((value) => value + 1)
    window.addEventListener(ASSETS_CHANGED, refresh)
    return () => window.removeEventListener(ASSETS_CHANGED, refresh)
  }, [])

  const reuse = useCallback((asset: Asset) => {
    const detail = reuseDetailFor(asset)
    if (detail) emitReusePrompt(detail)
    setPreview(null)
  }, [])

  const copy = useCallback(async (prompt: string) => {
    if (await copyText(prompt)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }, [])

  const empty = items !== null && items.length === 0 && !running

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {empty || failed ? (
        <div className="flex h-full flex-col items-center justify-center px-8 pb-10 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20">
            <Sparkles className="size-5" />
          </span>
          <h3 className="mt-5 text-lg font-semibold tracking-tight">
            {failed ? '近期作品加载失败' : episodeCode ? '为这一集创作第一个镜头' : '从一句描述开始'}
          </h3>
          <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
            {failed
              ? '不影响生成，稍后刷新即可。'
              : '在下方描述画面或镜头。把左侧的图片拖进输入框作为参考，或切到视频，用首尾帧锁定构图。'}
          </p>
        </div>
      ) : (
        <div className="mx-auto max-w-5xl px-6 pt-6 pb-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[13px] font-medium">近期生成</h3>
            <span className="text-[11px] text-muted-foreground">
              {copied ? '已复制提示词' : '点开查看参数 · 拖到下方继续迭代'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
            {running ? (
              <div>
                <div
                  className={cn(
                    'relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-primary/30 bg-primary/5',
                    'aspect-video',
                  )}
                >
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-primary/10 via-transparent to-primary/10" />
                  <Loader2 className="relative size-5 animate-spin text-primary" />
                  <span className="relative font-mono text-[11px] tabular-nums text-muted-foreground">
                    {runningKind === 'video' ? '视频' : '图片'}生成中 · {formatClock(elapsed)}
                  </span>
                </div>
              </div>
            ) : null}
            {(items ?? []).map((asset) => (
              <StageTile key={asset.id} asset={asset} onOpen={() => setPreview(asset)} />
            ))}
          </div>
        </div>
      )}

      <AssetPreview
        asset={preview}
        onClose={() => setPreview(null)}
        onCopyPrompt={(prompt) => void copy(prompt)}
        onReusePrompt={reuse}
      />
    </div>
  )
}

function StageTile({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const isVideo = asset.kind === 'video'
  const src = asset.content_url ?? ''
  const prompt = assetPrompt(asset)
  const Icon = isVideo ? Video : ImageIcon
  return (
    <figure className="animate-rise">
      <button
        type="button"
        draggable
        onDragStart={(event) => startAssetDrag(event, asset)}
        onClick={onOpen}
        aria-label={`查看 ${asset.name}`}
        className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border bg-muted text-left transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[var(--shadow-soft)] focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {isVideo ? (
          <VideoThumb src={src} className="aspect-video w-full" />
        ) : (
          <img src={src} alt={asset.name} loading="lazy" draggable={false} className="block aspect-video w-full object-cover" />
        )}
        <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-2.5 pt-8 pb-2 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <span className="line-clamp-2 text-[11px] leading-snug">{prompt ?? asset.name}</span>
          <span className="mt-1 flex items-center gap-1 text-[10px] text-white/70">
            <Icon className="size-3" />
            {formatRelative(asset.created_at)}
          </span>
        </figcaption>
      </button>
    </figure>
  )
}
