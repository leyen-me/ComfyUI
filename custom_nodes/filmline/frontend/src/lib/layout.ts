/** 布局相关的纯函数：路由分段、移动端标签与浮层尺寸约束。 */

export type ProjectSection = 'project-assets' | 'episode-list' | 'episode-assets' | 'other'

export type MobileProjectTab = 'assets' | 'episodes' | 'agent'

/**
 * 解析项目页在 basePath（可能带 /s/:sessionId）之后的分段。
 * 只关心「当前应该展示哪类内容」，不依赖组件状态，便于测试。
 */
export function projectSection(pathname: string, basePath: string): ProjectSection {
  const tail = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname
  const parts = tail.split('/').filter(Boolean)
  if (parts[0] === 'assets') return 'project-assets'
  if (parts[0] === 'episodes') {
    return parts.length === 1 ? 'episode-list' : 'episode-assets'
  }
  return 'other'
}

/**
 * 移动端底部导航当前选中项。
 * 助手是覆盖在资产区之上的独立面板；其余路由都归属于「资产 / 分集」。
 */
export function mobileProjectTab(
  section: ProjectSection,
  pane: 'assets' | 'agent',
): MobileProjectTab {
  if (pane === 'agent') return 'agent'
  return section === 'episode-list' ? 'episodes' : 'assets'
}

export const POPOVER_EDGE = 8

/** 浮层宽度不能超过视口，避免在窄屏上左右溢出。 */
export function fitPopoverWidth(width: number, viewportWidth: number, edge = POPOVER_EDGE): number {
  return Math.max(0, Math.min(width, viewportWidth - edge * 2))
}

/** 浮层高度不能超过视口；内容超出时由浮层内部滚动。 */
export function fitPopoverHeight(viewportHeight: number, edge = POPOVER_EDGE): number {
  return Math.max(0, viewportHeight - edge * 2)
}
