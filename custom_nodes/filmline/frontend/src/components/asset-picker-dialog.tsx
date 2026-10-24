import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Search } from 'lucide-react'

import { ApiError, api, type Asset, type Project } from '@/lib/api'
import { assetDimensions } from '@/lib/asset-meta'
import { formatTime } from '@/lib/format'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input } from './ui/field'

interface AssetPickerDialogProps {
  open: boolean
  title: string
  project: Project
  /** 为空表示项目级资产 */
  episodeCode?: string
  onOpenChange: (open: boolean) => void
  onSelect: (asset: Asset) => void
}

/** 首尾帧等槽位的资产选择器：拖拽之外的键盘/触屏入口。 */
export function AssetPickerDialog({
  open,
  title,
  project,
  episodeCode,
  onOpenChange,
  onSelect,
}: AssetPickerDialogProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects.assets
      .list(project.code, { kind: 'image', episode: episodeCode, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result.items)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : '加载图片失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, project.code, episodeCode, reloadToken])

  useEffect(() => {
    if (!open) setKeyword('')
  }, [open])

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return assets
    return assets.filter((asset) => asset.name.toLowerCase().includes(query))
  }, [assets, keyword])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="只显示图片资产；生成结果和上传的图片都在这里。"
      className="w-[min(680px,94vw)]"
      footer={<Button onClick={() => onOpenChange(false)}>取消</Button>}
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={keyword}
          placeholder="按名称筛选"
          aria-label="筛选图片"
          className="pl-8"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="max-h-[56vh] min-h-40 overflow-y-auto pb-3">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </div>
        ) : null}

        {!loading && error ? (
          <div className="flex flex-col items-center gap-3 py-12 text-xs text-destructive">
            <span>{error}</span>
            <Button size="sm" variant="secondary" onClick={() => setReloadToken((value) => value + 1)}>
              <RefreshCw className="size-3.5" />
              重试
            </Button>
          </div>
        ) : null}

        {!loading && !error && filtered.length === 0 ? (
          <p className="py-12 text-center text-xs text-muted-foreground">
            {assets.length === 0 ? '还没有图片资产，先上传一张。' : '没有匹配的图片。'}
          </p>
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                onClick={() => onSelect(asset)}
              >
                <span className="block aspect-video overflow-hidden bg-muted">
                  <img
                    src={asset.content_url ?? ''}
                    alt={asset.name}
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                  />
                </span>
                <span className="block px-2 py-1.5">
                  <span className="block truncate text-xs font-medium" title={asset.name}>
                    {asset.name}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                    {assetDimensions(asset) ?? formatTime(asset.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
