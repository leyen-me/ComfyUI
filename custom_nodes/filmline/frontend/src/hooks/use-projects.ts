import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, type ProjectList } from '@/lib/api'

/** 项目数量有限，一次取回即可；后端 limit 上限为 200。 */
export const PROJECT_LIST_LIMIT = 200

export interface ProjectQuery {
  q: string
}

const INITIAL_QUERY: ProjectQuery = { q: '' }

/**
 * 项目列表数据层：查询条件与竞态取消（AbortController）在这里，
 * 组件只负责渲染。过期响应不会覆盖新状态。
 */
export function useProjects() {
  const [query, setQuery] = useState<ProjectQuery>(INITIAL_QUERY)
  const [data, setData] = useState<ProjectList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects
      .list({ ...query, limit: PROJECT_LIST_LIMIT }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : '加载项目失败，请稍后重试')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [query, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const search = useCallback((q: string) => {
    setQuery({ q })
  }, [])

  return { data, loading, error, query, search, reload }
}
