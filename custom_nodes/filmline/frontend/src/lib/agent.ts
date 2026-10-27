/** Agent 会话客户端：REST + SSE 断点续传。 */

import { ApiError, type FieldIssue } from './api'

const BASE = '/studio/api'

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'waiting_input'
  | 'paused'
  | 'interrupted'
  | 'error'

export interface AgentUsage {
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  cache_hit_tokens?: number | null
  cache_miss_tokens?: number | null
  context_window?: number
}

export interface AgentSession {
  id: number
  project_id: number
  title: string
  status: AgentStatus
  model: string
  thinking: string
  reasoning_effort: string
  context_window: number
  usage: AgentUsage | null
  turn: number
  last_seq: number
  created_at: string
  updated_at: string
}

export interface AgentSessionList {
  items: AgentSession[]
  model: string
  context_window: number
  configured: boolean
  thinking: string
  reasoning_effort: string
}

export interface AgentSessionSettings {
  thinking: string
  reasoning_effort: string
}

export interface AgentAssetRef {
  id: number
  kind: string
  name: string
}

export interface AgentQuestionOption {
  label: string
  description?: string
}

export interface AgentQuestion {
  id: string
  header: string
  question: string
  options: AgentQuestionOption[]
  multiple?: boolean
}

export interface AgentToolInfo {
  name: string
  label: string
  description: string
  write: boolean
  destructive: boolean
}

export interface AgentSystemPrompt {
  prompt: string
  chars: number
  sha256: string
  model: string
  thinking: string
  reasoning_effort: string | null
  tools: AgentToolInfo[]
  tool_count: number
  note: string
}

export interface AgentEvent {
  seq: number
  type: string
  data: Record<string, unknown>
  ts?: string
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string; details?: FieldIssue[] }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (response.status === 204) return undefined as T
  let body: Envelope<T> | null = null
  try {
    body = (await response.json()) as Envelope<T>
  } catch {
    body = null
  }
  if (!response.ok || !body?.ok) {
    throw new ApiError(
      body?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      body?.error?.code ?? 'unknown',
      response.status,
      body?.error?.details ?? [],
    )
  }
  return body.data as T
}

export const agentApi = {
  systemPrompt() {
    return call<AgentSystemPrompt>('/agent/system-prompt')
  },

  listSessions(projectCode: string) {
    return call<AgentSessionList>(`/projects/${encodeURIComponent(projectCode)}/agent/sessions`)
  },

  createSession(projectCode: string, settings?: AgentSessionSettings) {
    return call<AgentSession>(`/projects/${encodeURIComponent(projectCode)}/agent/sessions`, {
      method: 'POST',
      body: JSON.stringify(settings ?? {}),
    })
  },

  getSession(sessionId: number) {
    return call<AgentSession>(`/agent/sessions/${sessionId}`)
  },

  renameSession(sessionId: number, title: string) {
    return call<AgentSession>(`/agent/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  },

  updateSessionSettings(sessionId: number, settings: AgentSessionSettings) {
    return call<AgentSession>(`/agent/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    })
  },

  deleteSession(sessionId: number) {
    return call<void>(`/agent/sessions/${sessionId}`, { method: 'DELETE' })
  },

  sendMessage(sessionId: number, text: string, assetIds: number[]) {
    return call<{ session: AgentSession; seq: number; turn: number }>(
      `/agent/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text, asset_ids: assetIds }),
      },
    )
  },

  pause(sessionId: number) {
    return call<{ paused: boolean; session: AgentSession }>(
      `/agent/sessions/${sessionId}/pause`,
      { method: 'POST' },
    )
  },

  resume(sessionId: number) {
    return call<{ resumed: boolean; session: AgentSession }>(
      `/agent/sessions/${sessionId}/resume`,
      { method: 'POST' },
    )
  },

  answer(sessionId: number, toolCallId: string, answers: Record<string, unknown>) {
    return call<{ accepted: boolean }>(`/agent/sessions/${sessionId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ tool_call_id: toolCallId, answers }),
    })
  },

  pauseTool(sessionId: number, toolCallId: string) {
    return call<{ paused: boolean }>(
      `/agent/sessions/${sessionId}/tools/${encodeURIComponent(toolCallId)}/pause`,
      { method: 'POST' },
    )
  },
}

/**
 * 订阅会话事件：先从 after 回放，再接实时；连接断开自动带最新 seq 重连。
 * 返回取消函数。
 */
export function subscribeAgentEvents(
  sessionId: number,
  after: number,
  handlers: {
    onEvent: (event: AgentEvent) => void
    onState?: (state: 'connecting' | 'live' | 'closed') => void
    onError?: (message: string) => void
  },
): () => void {
  let closed = false
  let controller: AbortController | null = null
  let last = after

  async function loop() {
    let delay = 600
    while (!closed) {
      controller = new AbortController()
      handlers.onState?.('connecting')
      try {
        const response = await fetch(
          `${BASE}/agent/sessions/${sessionId}/events?after=${last}`,
          { signal: controller.signal, headers: { Accept: 'text/event-stream' } },
        )
        if (!response.ok || !response.body) {
          throw new Error(`事件流连接失败（HTTP ${response.status}）`)
        }
        handlers.onState?.('live')
        delay = 600
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (!closed) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let index = buffer.indexOf('\n\n')
          while (index >= 0) {
            const frame = buffer.slice(0, index)
            buffer = buffer.slice(index + 2)
            index = buffer.indexOf('\n\n')
            if (!frame || frame.startsWith(':')) continue
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
            if (!data) continue
            try {
              const event = JSON.parse(data) as AgentEvent
              if (typeof event.seq !== 'number' || event.seq <= last) continue
              last = event.seq
              handlers.onEvent(event)
            } catch {
              // 忽略损坏帧，保持流继续
            }
          }
        }
      } catch (cause) {
        if (closed || controller.signal.aborted) return
        handlers.onError?.(cause instanceof Error ? cause.message : '事件流中断')
      }
      if (closed) return
      handlers.onState?.('connecting')
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(5000, delay * 1.6)
    }
  }

  void loop()

  return () => {
    closed = true
    controller?.abort()
    handlers.onState?.('closed')
  }
}
