import { useCallback, useEffect, useState } from 'react'

import { ApiError, api, type AssetCounts, type AssetKind, type AssetList } from '@/lib/api'

/** 某一分类下的资产列表。 */
export function useAssets(ref: string, kind: AssetKind) {
  const [data, setData] = useState<AssetList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!ref) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects.assets
      .list(ref, kind, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : '加载资产失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [ref, kind, reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])
  return { data, loading, error, reload }
}

/** 各分类数量，用于左侧导航。 */
export function useAssetCounts(ref: string, version: number) {
  const [counts, setCounts] = useState<AssetCounts>({ text: 0, image: 0, video: 0 })

  useEffect(() => {
    if (!ref) return
    const controller = new AbortController()
    api.projects.assets
      .counts(ref, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCounts(result)
      })
      .catch(() => {
        /* 计数失败不影响主流程 */
      })
    return () => controller.abort()
  }, [ref, version])

  return counts
}
