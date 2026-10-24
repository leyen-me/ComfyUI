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

async function unwrap<T>(response: Response): Promise<T> {
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  return unwrap<T>(response)
}

function toQuery(params: ListParams): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  search.set('limit', String(params.limit ?? 20))
  search.set('offset', String(params.offset ?? 0))
  return search.toString()
}

export type AssetKind = 'text' | 'image' | 'video'
export type AssetSource = 'user' | 'ai'

export interface Asset {
  id: number
  project_id: number
  kind: AssetKind
  source: AssetSource
  name: string
  text_content: string | null
  mime_type: string | null
  size_bytes: number | null
  content_url: string | null
  meta: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export interface AssetList {
  items: Asset[]
  total: number
}

export type AssetCounts = Record<AssetKind, number>

export interface TextAssetInput {
  name: string
  content?: string
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

    assets: {
      list: (ref: string | number, kind: AssetKind, signal?: AbortSignal) =>
        request<AssetList>(
          `/projects/${encodeURIComponent(ref)}/assets?kind=${kind}&limit=200`,
          { signal },
        ),

      counts: (ref: string | number, signal?: AbortSignal) =>
        request<AssetCounts>(`/projects/${encodeURIComponent(ref)}/assets/counts`, { signal }),

      createText: (ref: string | number, input: TextAssetInput) =>
        request<Asset>(
          `/projects/${encodeURIComponent(ref)}/assets`,
          { method: 'POST', body: JSON.stringify({ kind: 'text', ...input }) },
        ),

      upload: async (
        ref: string | number,
        file: File,
        options: { source?: AssetSource; name?: string } = {},
      ): Promise<Asset> => {
        const form = new FormData()
        form.append('file', file)

        const query = new URLSearchParams()
        if (options.source) query.set('source', options.source)
        if (options.name) query.set('name', options.name)

        const response = await fetch(
          `${BASE}/projects/${encodeURIComponent(ref)}/assets/upload?${query.toString()}`,
          { method: 'POST', body: form },
        )
        return unwrap<Asset>(response)
      },

      update: (assetId: number, patch: { name?: string; text_content?: string }) =>
        request<Asset>(`/assets/${assetId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),

      remove: (assetId: number) =>
        request<void>(`/assets/${assetId}`, { method: 'DELETE' }),
    },
  },
}
