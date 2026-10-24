/** 资产变更事件：生成完成后通知资产列表刷新。 */
export const ASSETS_CHANGED = 'filmline:assets-changed'

/** 复用提示词：把某个 AI 资产的生成参数回填到右侧生成面板。 */
export const REUSE_PROMPT = 'filmline:reuse-prompt'

export interface ReusePromptDetail {
  prompt: string
  kind: 'image' | 'video'
  size?: string
  count?: number
  duration?: number
  /** 原生成使用的参考图 id，复用时用来还原图片块 */
  refIds?: number[]
}

export function emitAssetsChanged(): void {
  window.dispatchEvent(new CustomEvent(ASSETS_CHANGED))
}

export function emitReusePrompt(detail: ReusePromptDetail): void {
  window.dispatchEvent(new CustomEvent<ReusePromptDetail>(REUSE_PROMPT, { detail }))
}
