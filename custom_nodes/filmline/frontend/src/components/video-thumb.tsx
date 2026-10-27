import { useRef, useState } from 'react'
import { Play } from 'lucide-react'

import { formatClock } from '@/lib/format'
import { cn } from '@/lib/utils'

/** 跳过可能全黑的第 0 帧，作为静态封面 */
const POSTER_TIME = 0.1

interface VideoThumbProps {
  src: string
  className?: string
  onError?: () => void
}

/**
 * 静音缩略视频：静止时显示首帧与时长，悬停才播放并显示进度。
 * 不带原生控制条，点击交给外层打开详情。外层需要有 `group` 类名。
 */
export function VideoThumb({ src, className, onError }: VideoThumbProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)

  function start() {
    const video = ref.current
    if (!video) return
    void video.play().then(
      () => setPlaying(true),
      () => undefined,
    )
  }

  function stop() {
    const video = ref.current
    if (!video) return
    video.pause()
    video.currentTime = POSTER_TIME
    setPlaying(false)
    setProgress(0)
  }

  return (
    <div className={cn('relative', className)} onMouseEnter={start} onMouseLeave={stop}>
      <video
        ref={ref}
        src={`${src}#t=${POSTER_TIME}`}
        preload="metadata"
        muted
        loop
        playsInline
        draggable={false}
        className="block size-full bg-black object-cover"
        onError={onError}
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration
          setDuration(Number.isFinite(value) ? value : null)
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          if (video.duration > 0) setProgress(video.currentTime / video.duration)
        }}
      />
      <span
        className={cn(
          'pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/55 py-0.5 pr-2 pl-1.5 font-mono text-[10px] text-white backdrop-blur-sm transition-opacity',
          playing && 'opacity-0',
        )}
      >
        <Play className="size-2.5 fill-current" />
        {duration !== null ? formatClock(duration) : '视频'}
      </span>
      <span
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-white/15 transition-opacity',
          playing ? 'opacity-100' : 'opacity-0',
        )}
      >
        <span className="block h-full bg-primary" style={{ width: `${progress * 100}%` }} />
      </span>
    </div>
  )
}
