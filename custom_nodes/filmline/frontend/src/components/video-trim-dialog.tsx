import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Scissors } from 'lucide-react'

import type { ReferenceVideo } from '@/lib/references'
import { formatClock } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

interface VideoTrimDialogProps {
  open: boolean
  video: ReferenceVideo | null
  onOpenChange: (open: boolean) => void
  onApply: (start: number, end: number) => void
}

const MIN_CLIP = 2
const MAX_CLIP = 15
const EDGE = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 参考视频裁剪：一个双柄区间滑块。
 * 左柄=入点，右柄=出点；播放从入点开始，并在区间内循环。
 */
export function VideoTrimDialog({
  open,
  video,
  onOpenChange,
  onApply,
}: VideoTrimDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [total, setTotal] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const duration = video?.duration ?? 0
    const trimStart = clamp(video?.trimStart ?? 0, 0, Math.max(0, duration - MIN_CLIP))
    const trimEnd = video?.trimEnd && video.trimEnd > 0 ? video.trimEnd : duration
    setTotal(duration)
    setStart(trimStart)
    // 没有既有裁剪时默认取前 15 秒，超长视频也能直接应用
    setEnd(duration > 0 ? clamp(trimEnd, Math.min(duration, trimStart + MIN_CLIP), Math.min(duration, trimStart + MAX_CLIP)) : trimEnd)
    setTime(trimStart)
    setPlaying(false)
    setReady(false)
    setError(null)
  }, [open, video?.assetId, video?.duration, video?.trimStart, video?.trimEnd])

  const clip = Math.max(0, end - start)
  const frames = Math.round(clip * 24)
  const valid = total > 0 && clip >= MIN_CLIP - 0.05 && clip <= MAX_CLIP + 0.05
  const maxStart = Math.max(0, total - MIN_CLIP)
  const percent = (value: number) => (total > 0 ? `${(value / total) * 100}%` : '0%')

  function seek(next: number) {
    const element = videoRef.current
    if (!element || !ready) return
    const target = clamp(next, 0, Math.max(0, total - 1 / 24))
    element.currentTime = target
    setTime(target)
  }

  function togglePlay() {
    const element = videoRef.current
    if (!element || !ready) return
    if (element.paused) {
      if (element.currentTime < start || element.currentTime >= end - 0.02) {
        element.currentTime = start
      }
      element.play().catch(() => setError('浏览器无法播放这个视频'))
    } else {
      element.pause()
    }
  }

  function changeStart(value: number) {
    const next = round(clamp(value, 0, maxStart))
    let nextEnd = end
    // 保证最短 2 秒；超出 15 秒时把出点一起往前收
    if (nextEnd - next < MIN_CLIP) nextEnd = Math.min(total, next + MIN_CLIP)
    if (nextEnd - next > MAX_CLIP) nextEnd = next + MAX_CLIP
    setStart(next)
    setEnd(round(nextEnd))
    seek(next)
  }

  function changeEnd(value: number) {
    const next = round(
      clamp(value, Math.min(total, start + MIN_CLIP), Math.min(total, start + MAX_CLIP)),
    )
    setEnd(next)
  }

  function apply() {
    if (!valid) return
    onApply(round(start), round(end))
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="裁剪参考视频"
      description={
        video
          ? `${video.name} · 拖动两个手柄选择 2–15 秒的区间，播放从入点开始`
          : '拖动两个手柄选择参考视频区间'
      }
      className="sm:w-[min(760px,96vw)]"
      mobileFullHeight
      footer={
        <>
          <span className="mr-auto self-center font-mono text-[11px] text-muted-foreground">
            {total > 0
              ? `入点 ${start.toFixed(2)}s · 出点 ${end.toFixed(2)}s · ${clip.toFixed(2)}s（${frames} 帧）`
              : '正在读取视频信息…'}
          </span>
          <Button onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!valid} onClick={apply}>
            <Scissors className="size-3.5" />
            应用裁剪
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
          className="max-h-[calc(100dvh-18rem)] w-full rounded-lg bg-black object-contain sm:max-h-[46vh]"
          onLoadedMetadata={(event) => {
            const value = event.currentTarget.duration
            const next = Number.isFinite(value) ? value : 0
            const initialStart = clamp(video?.trimStart ?? 0, 0, Math.max(0, next - MIN_CLIP))
            setTotal(next)
            setStart(initialStart)
            setEnd((current) =>
              current > 0
                ? clamp(
                    current,
                    Math.min(next, initialStart + MIN_CLIP),
                    Math.min(next, initialStart + MAX_CLIP),
                  )
                : Math.min(next, initialStart + MAX_CLIP),
            )
            event.currentTarget.currentTime = Math.min(initialStart, Math.max(0, next - 0.001))
          }}
          onLoadedData={() => setReady(true)}
          onCanPlay={() => setReady(true)}
          onSeeked={(event) => {
            setReady(true)
            setTime(event.currentTarget.currentTime)
          }}
          onTimeUpdate={(event) => {
            const element = event.currentTarget
            setTime(element.currentTime)
            // 播放从入点开始，到出点回到入点
            if (!element.paused && element.currentTime >= end - 0.02) {
              element.currentTime = start
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setError('无法加载这个视频文件')}
          onClick={togglePlay}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label={playing ? '暂停' : '从入点播放'}
            title={playing ? '暂停' : '从入点播放'}
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            onClick={togglePlay}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <span className="w-20 shrink-0 font-mono text-[11px] text-muted-foreground">
            {formatClock(time)} / {formatClock(total)}
          </span>

          {/* 双柄区间滑块：轨道与选区在底层，两个原生 range 只暴露手柄点击 */}
          <div className="relative h-6 min-w-0 flex-1">
            <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted">
              <div
                className="absolute inset-y-0 rounded-full bg-primary/40"
                style={{ left: percent(start), width: `${total > 0 ? (clip / total) * 100 : 0}%` }}
              />
              <div
                className="absolute inset-y-0 rounded-full bg-primary/80"
                style={{
                  left: percent(start),
                  width:
                    total > 0
                      ? `${(Math.min(Math.max(time, start), end) - start) / total * 100}%`
                      : '0%',
                }}
              />
            </div>
            {/* 播放头：跟随当前画面在区间内移动 */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute top-1/2 z-[5] h-5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/70 transition-[left] duration-150 ease-linear',
                playing && 'animate-pulse bg-primary ring-2 ring-primary/25',
              )}
              style={{ left: percent(total > 0 ? Math.min(Math.max(time, 0), total) : 0) }}
            />
            <input
              type="range"
              min={0}
              max={total}
              step={EDGE}
              value={start}
              disabled={!ready || total <= 0}
              aria-label="裁剪区间入点"
              className="pointer-events-none absolute inset-0 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              onChange={(event) => changeStart(Number(event.target.value))}
            />
            <input
              type="range"
              min={0}
              max={total}
              step={EDGE}
              value={end}
              disabled={!ready || total <= 0}
              aria-label="裁剪区间出点"
              className="pointer-events-none absolute inset-0 z-10 h-6 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent disabled:cursor-not-allowed disabled:opacity-50 [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
              onChange={(event) => changeEnd(Number(event.target.value))}
            />
          </div>
        </div>

        {!valid && total > 0 ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400" role="alert">
            区间需要 2–15 秒（当前 {clip.toFixed(2)} 秒）
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
