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

export type AssetKind = 'text' | 'image' | 'video' | 'audio'
export type AssetSource = 'user' | 'ai'

export interface Asset {
  id: number
  project_id: number
  episode_id: number | null
  kind: AssetKind
  source: AssetSource
  name: string
  text_content: string | null
  mime_type: string | null
  size_bytes: number | null
  content_url: string | null
  meta: Record<string, unknown> | null
  gen_started_at: string | null
  gen_elapsed_ms: number | null
  created_at: string
  updated_at: string
}

export interface AssetList {
  items: Asset[]
  total: number
}

export type AssetCounts = Record<AssetKind, number>

export interface Episode {
  id: number
  project_id: number
  number: number
  code: string
  title: string
  synopsis: string
  created_at: string
  updated_at: string
}

export interface EpisodeList {
  items: Episode[]
  total: number
}

export interface EpisodeInput {
  title?: string
  synopsis?: string
}

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
      list: (
        ref: string | number,
        params: { kind: AssetKind; episode?: string; signal?: AbortSignal },
      ) => {
        const query = new URLSearchParams({ kind: params.kind, limit: '200' })
        if (params.episode) query.set('episode', params.episode)
        return request<AssetList>(
          `/projects/${encodeURIComponent(ref)}/assets?${query.toString()}`,
          { signal: params.signal },
        )
      },

      get: (assetId: number, signal?: AbortSignal) =>
        request<Asset>(`/assets/${assetId}`, { signal }),

      counts: (
        ref: string | number,
        params: { episode?: string; signal?: AbortSignal } = {},
      ) => {
        const query = new URLSearchParams()
        if (params.episode) query.set('episode', params.episode)
        const suffix = query.toString() ? `?${query.toString()}` : ''
        return request<AssetCounts>(
          `/projects/${encodeURIComponent(ref)}/assets/counts${suffix}`,
          { signal: params.signal },
        )
      },

      createText: (ref: string | number, input: TextAssetInput, episode?: string) => {
        const query = episode ? `?episode=${encodeURIComponent(episode)}` : ''
        return request<Asset>(`/projects/${encodeURIComponent(ref)}/assets${query}`, {
          method: 'POST',
          body: JSON.stringify({ kind: 'text', ...input }),
        })
      },

      upload: async (
        ref: string | number,
        file: File,
        options: { source?: AssetSource; name?: string; episode?: string } = {},
      ): Promise<Asset> => {
        const form = new FormData()
        form.append('file', file)

        const query = new URLSearchParams()
        if (options.source) query.set('source', options.source)
        if (options.name) query.set('name', options.name)
        if (options.episode) query.set('episode', options.episode)

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

      generate: (
        ref: string | number,
        input:
          | {
              kind: 'image'
              prompt: string
              size: string
              resolution?: string
              count: number
              refs?: number[]
            }
          |
              {
                kind: 'video'
                /** 首尾帧 / 参考生成 */
                mode?: 'keyframes' | 'reference'
                prompt: string
                size: string
                resolution?: string
                duration: number
                first_frame_id?: number | null
                last_frame_id?: number | null
                /** 参考生成模式的图片资产 id（顺序即 <Picture N>）；首尾帧模式兼容旧客户端最多 1 张 */
                refs?: number[]
              },
        episode?: string,
      ) => {
        const query = episode ? `?episode=${encodeURIComponent(episode)}` : ''
        return request<{ items: Asset[]; kind: string; elapsed: number }>(
          `/projects/${encodeURIComponent(ref)}/generate${query}`,
          { method: 'POST', body: JSON.stringify(input) },
        )
      },

    episodes: {
      list: (ref: string | number, signal?: AbortSignal) =>
        request<EpisodeList>(`/projects/${encodeURIComponent(ref)}/episodes`, { signal }),

      get: (ref: string | number, code: string, signal?: AbortSignal) =>
        request<Episode>(
          `/projects/${encodeURIComponent(ref)}/episodes/${encodeURIComponent(code)}`,
          { signal },
        ),

      create: (ref: string | number, input: EpisodeInput = {}) =>
        request<Episode>(`/projects/${encodeURIComponent(ref)}/episodes`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),

      update: (episodeId: number, patch: EpisodeInput) =>
        request<Episode>(`/episodes/${episodeId}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }),

      remove: (episodeId: number) =>
        request<void>(`/episodes/${episodeId}`, { method: 'DELETE' }),

      reorder: (ref: string | number, ids: number[]) =>
        request<void>(`/projects/${encodeURIComponent(ref)}/episodes/order`, {
          method: 'PUT',
          body: JSON.stringify({ ids }),
        }),
    },
  },
}
