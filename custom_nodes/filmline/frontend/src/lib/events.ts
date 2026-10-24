/** 资产变更事件：生成完成后通知资产列表刷新。 */
export const ASSETS_CHANGED = 'filmline:assets-changed'

export function emitAssetsChanged(): void {
  window.dispatchEvent(new CustomEvent(ASSETS_CHANGED))
}
