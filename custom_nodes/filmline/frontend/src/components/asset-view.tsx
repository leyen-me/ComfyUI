import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Upload } from 'lucide-react'
import { Navigate, useParams } from 'react-router-dom'

import { ApiError, api, type Asset, type AssetKind, type Project } from '@/lib/api'
import { ASSET_KINDS, assetKindMeta } from '@/lib/asset-kinds'
import { useAssets } from '@/hooks/use-assets'
import { AssetList } from './asset-list'
import { TextAssetDialog } from './text-asset-dialog'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

interface AssetViewProps {
  project: Project
  onChanged: () => void
}

function normalizeKind(raw: string | undefined): AssetKind {
  return ASSET_KINDS.some((item) => item.value === raw) ? (raw as AssetKind) : 'text'
}

export function AssetView({ project, onChanged }: AssetViewProps) {
  const params = useParams()
  const rawKind = params.kind
  const valid = rawKind === undefined || ASSET_KINDS.some((item) => item.value === rawKind)
  const kind = normalizeKind(rawKind)
  const meta = assetKindMeta(kind)

  const { data, loading, error, reload } = useAssets(project.code, kind)
  const [textOpen, setTextOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'ok') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  const assets = data?.items ?? []
  const total = data?.total ?? assets.length

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      await api.projects.assets.upload(project.code, file)
      notify(`已上传「${file.name}」`)
      reload()
      onChanged()
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.projects.assets.remove(pendingDelete.id)
      notify(`已删除「${pendingDelete.name}」`)
      setPendingDelete(null)
      reload()
      onChanged()
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  if (!valid) return <Navigate to="assets/text" replace />

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{meta.label}</h2>
        <span className="font-mono text-[11px] text-muted-foreground">{total}</span>

        <div className="ml-auto">
          {kind === 'text' ? (
            <Button size="sm" variant="secondary" onClick={() => setTextOpen(true)}>
              <Plus className="size-3.5" />
              新建
            </Button>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={meta.accept}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  void handleFile(file)
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Upload className="size-3.5" />
                )}
                {uploading ? '上传中…' : '上传'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{error}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={reload}>
              重试
            </Button>
          </div>
        ) : null}

        {loading && assets.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载中…
          </div>
        ) : null}

        {!loading && !error && assets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-20 text-center text-sm text-muted-foreground">
            还没有{meta.label}资产
          </div>
        ) : null}

        {assets.length > 0 ? (
          <AssetList kind={kind} assets={assets} onDelete={setPendingDelete} />
        ) : null}
      </div>

      <TextAssetDialog
        open={textOpen}
        projectRef={project.code}
        onOpenChange={setTextOpen}
        onCreated={(asset) => {
          notify(`已创建「${asset.name}」`)
          reload()
          onChanged()
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="删除资产"
        footer={
          <>
            <Button onClick={() => setPendingDelete(null)} disabled={deleting}>
              取消
            </Button>
            <Button
              variant="primary"
              className="bg-destructive text-white"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? '删除中…' : '删除'}
            </Button>
          </>
        }
      >
        <p className="pb-4 text-sm text-muted-foreground">
          确定删除「<span className="text-foreground">{pendingDelete?.name}</span>」吗？
        </p>
      </Dialog>

      <Toast message={toast} />
    </div>
  )
}
