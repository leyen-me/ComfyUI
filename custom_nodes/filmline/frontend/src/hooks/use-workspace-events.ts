import { useEffect, useRef } from 'react'

import {
  subscribeWorkspaceEvents,
  type WorkspaceEvent,
  type WorkspaceEventHandlers,
} from '@/lib/workspace-events'

/**
 * 订阅工作区事件。回调放在 ref 里，避免组件重渲染导致 SSE 反复重连。
 * `projectRef` 为空时接收全部项目的事件（项目列表页）。
 */
export function useWorkspaceEvents(
  projectRef: string | null,
  onEvent: WorkspaceEventHandlers['onEvent'],
  onResync?: WorkspaceEventHandlers['onResync'],
): void {
  const eventRef = useRef(onEvent)
  const resyncRef = useRef(onResync)
  eventRef.current = onEvent
  resyncRef.current = onResync

  useEffect(() => {
    return subscribeWorkspaceEvents(projectRef, {
      onEvent: (event: WorkspaceEvent) => eventRef.current(event),
      onResync: () => resyncRef.current?.(),
    })
  }, [projectRef])
}
