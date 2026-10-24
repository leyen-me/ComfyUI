import { useEffect, useMemo, useState } from 'react'
import { Check, FileAudio, Film, Loader2, RefreshCw, Search } from 'lucide-react'

import { ApiError, api, type Asset, type AssetKind, type Project } from '@/lib/api'
import { assetDimensions, generationMeta } from '@/lib/asset-meta'
import { formatSize, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input } from './ui/field'

interface AssetPickerDialogProps {
  open: boolean
  title: string
  project: Project
  /** 为空表示项目级资产 */
  episodeCode?: string
  /** 资产类型，默认图片 */
  kind?: Extract<AssetKind, 'image' | 'video' | 'audio'>
  onOpenChange: (open: boolean) => void
  /** 单选模式 */
  onSelect?: (asset: Asset) => void
  /** 多选模式：确认后一次回调，顺序与用户勾选顺序一致 */
  multiple?: boolean
  /** 多选剩余可选数量 */
  max?: number
  /** 已在别处选中的 id，显示为已添加且不可再选 */
  selectedIds?: number[]
  onSelectMany?: (assets: Asset[]) => void
}

/** 资产选择器：拖拽之外的键盘/触屏入口，支持单选与多选。 */
export function AssetPickerDialog({
  open,
  title,
  project,
  episodeCode,
  kind = 'image',
  onOpenChange,
  onSelect,
  multiple = false,
  max,
  selectedIds = [],
  onSelectMany,
}: AssetPickerDialogProps) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects.assets
      .list(project.code, { kind, episode: episodeCode, signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setAssets(result.items)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : `加载${kindLabel(kind)}失败`)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [open, project.code, episodeCode, kind, reloadToken])

  useEffect(() => {
    if (!open) return
    setKeyword('')
    setPicked([])
  }, [open])

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    if (!query) return assets
    return assets.filter((asset) => asset.name.toLowerCase().includes(query))
  }, [assets, keyword])

  const existing = useMemo(() => new Set(selectedIds), [selectedIds])
  const remaining = max ?? Number.POSITIVE_INFINITY

  function toggle(asset: Asset) {
    if (existing.has(asset.id)) return
    setPicked((previous) => {
      if (previous.includes(asset.id)) return previous.filter((id) => id !== asset.id)
      if (previous.length >= remaining) return previous
      return [...previous, asset.id]
    })
  }

  function confirm() {
    if (!onSelectMany) return
    const chosen = picked
      .map((id) => assets.find((asset) => asset.id === id))
      .filter((asset): asset is Asset => Boolean(asset))
    if (chosen.length === 0) return
    onSelectMany(chosen)
  }

  const footer = multiple ? (
    <>
      <span className="mr-auto self-center text-xs text-muted-foreground">
        已选 {picked.length} 张
        {Number.isFinite(remaining) ? ` · 还可选 ${Math.max(0, remaining - picked.length)}` : ''}
      </span>
      <Button onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" disabled={picked.length === 0} onClick={confirm}>
        添加 {picked.length} 张
      </Button>
    </>
  ) : (
    <Button onClick={() => onOpenChange(false)}>取消</Button>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        multiple
          ? `可多选${kindLabel(kind)}；勾选顺序就是参考素材的编号顺序。`
          : `只显示${kindLabel(kind)}资产；生成结果和上传的文件都在这里。`
      }
      className="w-[min(680px,94vw)]"
      footer={footer}
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={keyword}
          placeholder="按名称筛选"
          aria-label={`筛选${kindLabel(kind)}`}
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
            {assets.length === 0
              ? `还没有${kindLabel(kind)}资产，先上传一个。`
              : `没有匹配的${kindLabel(kind)}。`}
          </p>
        ) : null}

        {!loading && !error && filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {filtered.map((asset) => {
              const isExisting = existing.has(asset.id)
              const isPicked = picked.includes(asset.id)
              const disabled = isExisting || (!isPicked && picked.length >= remaining)
              return (
                <button
                  key={asset.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={multiple ? isExisting || isPicked : undefined}
                  className={cn(
                    'group relative overflow-hidden rounded-lg border bg-card text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
                    isPicked || isExisting ? 'border-primary ring-2 ring-primary/25' : 'border-border hover:border-primary/50',
                  )}
                  onClick={() => (multiple ? toggle(asset) : onSelect?.(asset))}
                >
                  <span className="flex aspect-video items-center justify-center overflow-hidden bg-muted text-muted-foreground">
                    {kind === 'image' ? (
                      <img
                        src={asset.content_url ?? ''}
                        alt={asset.name}
                        loading="lazy"
                        draggable={false}
                        className="size-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                      />
                    ) : kind === 'video' ? (
                      <Film className="size-6" />
                    ) : (
                      <FileAudio className="size-6" />
                    )}
                  </span>
                  {isPicked || isExisting ? (
                    <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                  {isExisting ? (
                    <span className="absolute top-1 left-1 rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      已添加
                    </span>
                  ) : null}
                  <span className="block px-2 py-1.5">
                    <span className="block truncate text-xs font-medium" title={asset.name}>
                      {asset.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                      {assetSubtitle(asset, kind)}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

function kindLabel(kind: 'image' | 'video' | 'audio'): string {
  if (kind === 'video') return '视频'
  if (kind === 'audio') return '音频'
  return '图片'
}

function assetSubtitle(asset: Asset, kind: 'image' | 'video' | 'audio'): string {
  const meta = generationMeta(asset)
  if (kind === 'image') {
    return assetDimensions(asset) ?? formatTime(asset.created_at)
  }
  const parts: string[] = []
  if (typeof meta.duration === 'number') parts.push(`${meta.duration.toFixed(1)}s`)
  if (asset.size_bytes) parts.push(formatSize(asset.size_bytes))
  return parts.length ? parts.join(' · ') : formatTime(asset.created_at)
}
