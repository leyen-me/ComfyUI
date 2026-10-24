/** 首尾帧槽位的纯逻辑：比例识别与不匹配提示。 */

export type KeyframeSlot = 'first' | 'last'
export type VideoRatio = '16:9' | '9:16'

const COMMON_RATIOS: ReadonlyArray<readonly [number, number]> = [
  [21, 9],
  [16, 9],
  [3, 2],
  [4, 3],
  [1, 1],
  [3, 4],
  [2, 3],
  [9, 16],
]

/** 把像素尺寸识别成常见比例标签；识别不出时回退成「宽×高」。 */
export function ratioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '未知比例'
  const value = width / height
  for (const [w, h] of COMMON_RATIOS) {
    if (Math.abs(value - w / h) <= 0.02) return `${w}:${h}`
  }
  return `${Math.round(width)}×${Math.round(height)}`
}

export interface RatioWarning {
  label: string
  /** 源图方向明显与输出相反时，给出可一键切换的比例 */
  suggested: VideoRatio | null
}

/**
 * 首尾帧按画布居中裁切，比例不一致会裁掉画面内容，因此需要显式提示。
 * 容差 3%，避免 1344×768 这类近似 16:9 的尺寸误报。
 */
export function ratioWarning(
  width: number,
  height: number,
  target: string,
): RatioWarning | null {
  if (width <= 0 || height <= 0) return null
  const targetValue = target === '9:16' ? 9 / 16 : 16 / 9
  const value = width / height
  if (Math.abs(value - targetValue) / targetValue <= 0.03) return null

  const suggested: VideoRatio | null =
    value > 1.05
      ? target === '16:9'
        ? null
        : '16:9'
      : value < 0.95
        ? target === '9:16'
          ? null
          : '9:16'
        : null
  return { label: ratioLabel(width, height), suggested }
}
