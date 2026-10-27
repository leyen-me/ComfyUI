/** 资产变更事件：生成完成或服务端推送变更后通知资产列表刷新。 */
export const ASSETS_CHANGED = 'filmline:assets-changed'

/** 复用提示词：把某个 AI 资产的生成参数回填到右侧生成面板。 */
export const REUSE_PROMPT = 'filmline:reuse-prompt'

export interface AssetsChangedDetail {
  /** 变更所属项目；为空表示本浏览器内的普通刷新 */
  projectId?: number
  episodeId?: number | null
  action?: string
  /** 本次受影响的资产 id，用于关闭已经失效的预览/编辑弹窗 */
  assetIds?: number[]
}

export interface ReusePromptDetail {
  prompt: string
  kind: 'image' | 'video'
  size?: string
  tier?: string
  count?: number
  duration?: number
  /** 原生成使用的参考图 id，复用时用来还原图片块 */
  refIds?: number[]
  /** 视频生成方式；旧资产为空，按首尾帧处理 */
  videoMode?: 'keyframes' | 'reference'
  firstFrameId?: number
  lastFrameId?: number
  /** 参考视频/音频 id 与视频原声开关 */
  videoRefIds?: number[]
  videoUseAudio?: boolean[]
  /** 每段参考视频的裁剪区间（与 videoRefIds 同序） */
  videoTrims?: Array<[number, number]>
  audioRefIds?: number[]
  /** 帧锚定：图片 id + 锚定秒数 */
  guideFrames?: Array<{ assetId: number; atSeconds: number }>
  refQuality?: 'quality' | 'fast'
  refScheduler?: 'simple' | 'beta' | 'normal'
  refImageSize?: 'match' | 'max'
  autoDuration?: boolean
  seed?: number
}

export function emitAssetsChanged(detail?: AssetsChangedDetail): void {
  window.dispatchEvent(new CustomEvent<AssetsChangedDetail>(ASSETS_CHANGED, { detail }))
}

export function emitReusePrompt(detail: ReusePromptDetail): void {
  window.dispatchEvent(new CustomEvent<ReusePromptDetail>(REUSE_PROMPT, { detail }))
}
