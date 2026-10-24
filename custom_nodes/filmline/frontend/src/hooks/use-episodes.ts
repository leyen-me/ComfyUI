import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, type Episode } from '@/lib/api'

/** 项目下的分集列表。 */
export function useEpisodes(ref: string) {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!ref) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects.episodes
      .list(ref, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setEpisodes(result.items)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : '加载分集失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [ref, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])
  return { episodes, loading, error, reload }
}
