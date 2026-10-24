/** 视频时长：与后端 `generation.py` 的 VIDEO_* 常量保持一致。 */

export const VIDEO_FPS = 24
export const DURATION_MIN_SECONDS = 5
export const DURATION_MAX_SECONDS = 15

/** 预设档位：保留原有的 5 / 10 秒，补充常用中间值与上限 */
export const DURATION_PRESETS: readonly number[] = [5, 8, 10, 12, 15]

/** 帧数按 17k+5 网格向上对齐（与后端 video_length 同一算法） */
export function videoFrames(seconds: number): number {
  let frames = Math.round(seconds * VIDEO_FPS)
  while (frames % 17 !== 5) frames += 1
  return frames
}

/** 网格对齐后的实际时长（秒） */
export function actualSeconds(seconds: number): number {
  return videoFrames(seconds) / VIDEO_FPS
}

export function isValidDuration(seconds: number): boolean {
  return (
    Number.isInteger(seconds) &&
    seconds >= DURATION_MIN_SECONDS &&
    seconds <= DURATION_MAX_SECONDS
  )
}

export function clampDuration(seconds: number): number {
  if (!Number.isFinite(seconds)) return DURATION_MIN_SECONDS
  return Math.min(DURATION_MAX_SECONDS, Math.max(DURATION_MIN_SECONDS, Math.round(seconds)))
}
