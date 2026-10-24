/**
 * 后端接口客户端。与 ComfyUI 同源，无需处理跨域。
 * 所有错误统一抛 ApiError，调用方只需展示 message。
 */

export interface Project {
  id: number
  code: string
  name: string
  description: string
  created_at: string
  updated_at: string
}

export interface ProjectList {
  items: Project[]
  total: number
  limit: number
  offset: number
}

export interface ProjectCreateInput {
  name: string
  description?: string
}

export interface ProjectPatchInput {
  name?: string
  description?: string
}

export interface ListParams {
  q?: string
  limit?: number
  offset?: number
}

export interface HealthInfo {
  version: string
  db: string
  schema_version: number
  projects: number
}

export interface FieldIssue {
  field: string
  message: string
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: FieldIssue[]

  constructor(message: string, code: string, status: number, details: FieldIssue[] = []) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }

  /** 把字段级校验错误拼成一句可以直接展示的话 */
  get fullMessage(): string {
    if (this.details.length === 0) return this.message
    return `${this.message}：${this.details.map((d) => d.message).join('；')}`
  }
}

const BASE = '/studio/api'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string; message?: string; details?: FieldIssue[] }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

function toQuery(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  search.set('limit', String(params.limit ?? 20))
  search.set('offset', String(params.offset ?? 0))
  return search.toString()
}

export const api = {
  health: (signal?: AbortSignal) => request<HealthInfo>('/health', { signal }),

  projects: {
    list: (params: ListParams, signal?: AbortSignal) =>
      request<ProjectList>(`/projects?${toQuery(params)}`, { signal }),

    get: (ref: string | number, signal?: AbortSignal) =>
      request<Project>(`/projects/${encodeURIComponent(ref)}`, { signal }),

    create: (input: ProjectCreateInput) =>
      request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),

    update: (ref: string | number, patch: ProjectPatchInput) =>
      request<Project>(`/projects/${encodeURIComponent(ref)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),

    remove: (ref: string | number) =>
      request<void>(`/projects/${encodeURIComponent(ref)}`, { method: 'DELETE' }),

    reorder: (ids: number[]) =>
      request<void>('/projects/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
  },
}
