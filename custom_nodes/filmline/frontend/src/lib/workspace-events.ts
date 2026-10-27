/**
 * 工作区实时事件订阅。
 *
 * 后端在资产/分集/项目写入提交后通过 SSE 广播；事件不落库、不回放，
 * 因此断线重连或页面重新可见时调用 `onResync` 做一次全量拉取。
 */

export type WorkspaceEvent =
  | {
      type: 'assets'
      action: string
      project_id: number
      episode_id?: number | null
      asset_ids?: number[]
    }
  | { type: 'episodes'; action: string; project_id: number; episode_id?: number }
  | { type: 'project'; action: string; project_id: number }
  | { type: 'projects'; action: string; project_id?: number }

export interface WorkspaceEventHandlers {
  onEvent: (event: WorkspaceEvent) => void
  /** 断线重连或页面恢复可见时触发 */
  onResync?: () => void
}

const ENDPOINT = '/studio/api/events'
const MAX_RETRY_MS = 5000

export function subscribeWorkspaceEvents(
  projectRef: string | null,
  handlers: WorkspaceEventHandlers,
): () => void {
  // 极旧的浏览器或 jsdom 测试环境没有 EventSource：静默降级为只拉一次
  if (typeof EventSource === 'undefined') return () => undefined

  const url = projectRef ? `${ENDPOINT}?project=${encodeURIComponent(projectRef)}` : ENDPOINT
  let source: EventSource | null = null
  let closed = false
  let connected = false
  let attempt = 0
  let retryTimer: number | null = null

  function clearRetry() {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function schedule() {
    if (closed || retryTimer !== null) return
    const delay = Math.min(MAX_RETRY_MS, 600 * 1.6 ** attempt)
    attempt += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      open()
    }, delay)
  }

  function open() {
    if (closed) return
    clearRetry()
    const next = new EventSource(url)
    source = next

    next.onopen = () => {
      attempt = 0
      // 第一次连接前页面已经拉过数据，只有重连才需要补齐
      if (connected) handlers.onResync?.()
      connected = true
    }

    next.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as WorkspaceEvent
        if (!event || typeof event.type !== 'string') return
        handlers.onEvent(event)
      } catch {
        // 忽略损坏帧，保持流继续
      }
    }

    next.onerror = () => {
      if (closed || source !== next) return
      // CONNECTING 表示浏览器会自动重连；只有 CLOSED 才需要手动重建
      if (next.readyState === EventSource.CLOSED) {
        next.close()
        source = null
        schedule()
      }
    }
  }

  function onVisibilityChange() {
    if (closed || document.visibilityState !== 'visible') return
    if (source?.readyState === EventSource.OPEN) handlers.onResync?.()
    else if (source === null) open()
  }

  open()
  document.addEventListener('visibilitychange', onVisibilityChange)

  return () => {
    closed = true
    clearRetry()
    source?.close()
    source = null
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
