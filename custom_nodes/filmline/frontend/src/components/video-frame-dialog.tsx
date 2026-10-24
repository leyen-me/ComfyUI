import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react'

import { ApiError, api, type Asset, type Project } from '@/lib/api'
import type { AssetDragPayload } from '@/lib/asset-drag'
import { emitAssetsChanged } from '@/lib/events'
import { formatClock } from '@/lib/format'
import type { KeyframeSlot } from '@/lib/keyframes'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

interface VideoFrameDialogProps {
  open: boolean
  video: AssetDragPayload | null
  slot: KeyframeSlot
  project: Project
  episodeCode?: string
  onOpenChange: (open: boolean) => void
  onExtracted: (asset: Asset, time: number) => void
}

/**
 * 从视频里挑一帧作为首帧/尾帧：把当前画面截成 PNG，登记为普通图片资产，
 * 后续工作流只认图片 id，不需要为“视频帧”增加新的后端类型。
 */
export function VideoFrameDialog({
  open,
  video,
  slot,
  project,
  episodeCode,
  onOpenChange,
  onExtracted,
}: VideoFrameDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fps = video?.fps && video.fps > 0 ? video.fps : 24
  const frameStep = 1 / fps
  const timelineMax = Math.max(0, duration - frameStep)
  const label = slot === 'first' ? '首帧' : '尾帧'

  useEffect(() => {
    if (!open) return
    setTime(0)
    setDuration(0)
    setPlaying(false)
    setReady(false)
    setCapturing(false)
    setError(null)
  }, [open, video?.assetId])

  function seek(next: number) {
    const element = videoRef.current
    if (!element || !ready) return
    if (!element.paused) element.pause()
    const target = Math.min(Math.max(next, 0), timelineMax)
    element.currentTime = target
    setTime(target)
  }

  function togglePlay() {
    const element = videoRef.current
    if (!element || !ready) return
    if (element.paused) {
      element.play().catch(() => setError('浏览器无法播放这个视频'))
    } else {
      element.pause()
    }
  }

  async function capture() {
    const element = videoRef.current
    if (!element || !ready || !element.videoWidth) {
      setError('视频尚未加载完成')
      return
    }
    if (!element.paused) element.pause()

    setCapturing(true)
    setError(null)
    const frameTime = element.currentTime
    try {
      const canvas = document.createElement('canvas')
      canvas.width = element.videoWidth
      canvas.height = element.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建画布')

      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      )
      if (!blob) throw new Error('无法导出这一帧')

      const base = (video?.name ?? 'video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_')
      const filename = `${base}_frame_${frameTime.toFixed(2)}.png`
      const file = new File([blob], filename, { type: 'image/png' })
      const asset = await api.projects.assets.upload(project.code, file, {
        name: filename,
        source: video?.source ?? 'user',
        episode: episodeCode,
        meta: {
          derived_from_asset_id: video?.assetId,
          frame_time: Number(frameTime.toFixed(3)),
          fps,
          width: canvas.width,
          height: canvas.height,
          origin: 'video_frame',
        },
      })

      emitAssetsChanged()
      onExtracted(asset, frameTime)
      onOpenChange(false)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.fullMessage
          : cause instanceof Error
            ? cause.message
            : '提取视频帧失败',
      )
    } finally {
      setCapturing(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`从视频选择${label}`}
      description={
        video
          ? `${video.name} · 拖动时间轴或逐帧选择，确认后会把这一帧保存为图片资产`
          : '选择一帧作为首帧或尾帧'
      }
      className="w-[min(820px,96vw)]"
      footer={
        <>
          <span className="mr-auto self-center font-mono text-[11px] text-muted-foreground">
            {formatClock(time)} · 第 {Math.round(time * fps) + 1} 帧（按 {fps}fps 步进）
          </span>
          <Button onClick={() => onOpenChange(false)} disabled={capturing}>
            取消
          </Button>
          <Button variant="primary" disabled={!ready || capturing} onClick={() => void capture()}>
            {capturing ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                保存中…
              </>
            ) : (
              `用这一帧作为${label}`
            )}
          </Button>
        </>
      }
    >
      <div className="pb-3">
        <video
          ref={videoRef}
          src={video?.src ?? ''}
          preload="auto"
          playsInline
          controls={false}
          className="max-h-[48vh] w-full rounded-lg bg-black object-contain"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration
            setDuration(Number.isFinite(value) ? value : 0)
            // 轻微 seek 强制解码第一帧，避免暂停时显示黑帧
            event.currentTarget.currentTime = Math.min(0.001, Number.isFinite(value) ? value : 0)
          }}
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onSeeked={(event) => {
            setReady(true)
            setTime(event.currentTarget.currentTime)
          }}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setError('无法加载这个视频文件')}
          onClick={togglePlay}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="第一帧"
            className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => seek(0)}
          >
            首帧
          </button>
          <button
            type="button"
            aria-label="上一帧"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => seek(time - frameStep)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label={playing ? '暂停' : '播放'}
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={togglePlay}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            aria-label="下一帧"
            className="cursor-pointer rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => seek(time + frameStep)}
          >
            <ChevronRight className="size-4" />
          </button>
          <button
            type="button"
            aria-label="最后一帧"
            className="cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={() => seek(Math.max(0, duration - frameStep))}
          >
            末帧
          </button>

          <input
            type="range"
            min={0}
            max={timelineMax}
            step={frameStep}
            value={Math.min(time, timelineMax)}
            disabled={!ready}
            aria-label="视频时间轴"
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
            onChange={(event) => seek(Number(event.target.value))}
          />
        </div>
      </div>

      {error ? (
        <p className="pb-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
