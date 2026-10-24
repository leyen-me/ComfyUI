import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Upload } from 'lucide-react'

import { ApiError, api, type Asset, type AssetKind, type Episode, type Project } from '@/lib/api'
import { assetKindMeta } from '@/lib/asset-kinds'
import { useAssetCounts, useAssets } from '@/hooks/use-assets'
import { ASSETS_CHANGED, emitReusePrompt } from '@/lib/events'
import { assetPrompt, generationMeta } from '@/lib/asset-meta'
import { copyText } from '@/lib/clipboard'
import { AssetDialog } from './asset-dialog'
import { AssetPreview } from './asset-preview'
import { AssetList } from './asset-list'
import { KindTabs } from './kind-tabs'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { MoreMenu } from './ui/more-menu'

interface AssetPanelProps {
  project: Project
  /** 为空表示项目级资产 */
  episode?: Episode | null
  kind: AssetKind
  onEditScope: () => void
  onDeleteScope: () => void
  /** 项目页内不再提供删除项目入口，删除只能回到项目列表操作 */
  allowDeleteScope?: boolean
}

export function AssetPanel({
  project,
  episode = null,
  kind,
  onEditScope,
  onDeleteScope,
  allowDeleteScope = true,
}: AssetPanelProps) {
  const scope = episode?.code
  const { data, loading, error, reload } = useAssets(project.code, kind, scope)

  const [countsVersion, setCountsVersion] = useState(0)
  const counts = useAssetCounts(project.code, scope, countsVersion)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Asset | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Asset | null>(null)
  const [preview, setPreview] = useState<Asset | null>(null)
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const meta = assetKindMeta(kind)
  const assets = data?.items ?? []
  const total = data?.total ?? assets.length
  const basePath = episode
    ? `/projects/${project.code}/episodes/${episode.code}/assets`
    : `/projects/${project.code}/assets`

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'ok') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  // 生成完成后刷新当前列表与计数
  useEffect(() => {
    function onChanged() {
      reload()
      setCountsVersion((value) => value + 1)
    }
    window.addEventListener(ASSETS_CHANGED, onChanged)
    return () => window.removeEventListener(ASSETS_CHANGED, onChanged)
  }, [reload])

  function refresh() {
    reload()
    setCountsVersion((value) => value + 1)
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setUploading(true)
    try {
      await api.projects.assets.upload(project.code, file, { episode: scope })
      notify(`已上传「${file.name}」`)
      refresh()
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '上传失败', 'error')
    } finally {
      setUploading(false)
    }
  }

  async function copyPrompt(prompt: string) {
    const copied = await copyText(prompt)
    if (copied) notify('已复制提示词')
    else setCopyFallback(prompt)
  }

  function reusePrompt(asset: Asset) {
    const prompt = assetPrompt(asset)
    if (!prompt) return
    const meta = generationMeta(asset)
    const isVideo = asset.kind === 'video'
    emitReusePrompt({
      prompt,
      kind: isVideo ? 'video' : 'image',
      size: meta.size,
      tier: meta.tier,
      count: meta.count ?? 1,
      duration: meta.duration ?? 5,
      refIds: meta.ref_ids ?? [],
      ...(isVideo
        ? {
            videoMode: meta.video_mode === 'reference' ? 'reference' : 'keyframes',
            firstFrameId: meta.first_frame_id ?? meta.ref_ids?.[0] ?? undefined,
            lastFrameId:
              meta.last_frame_id ??
              (meta.video_mode === 'keyframes' ? meta.ref_ids?.[1] : undefined) ??
              undefined,
            videoRefIds: meta.ref_video_ids ?? [],
            videoUseAudio: meta.ref_video_use_audio ?? [],
            audioRefIds: meta.ref_audio_ids ?? [],
          }
        : {}),
    })
    setPreview(null)
    notify('已填入生成面板')
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.projects.assets.remove(pendingDelete.id)
      notify(`已删除「${pendingDelete.name}」`)
      setPendingDelete(null)
      refresh()
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium" title={episode?.title ?? project.name}>
              {episode ? `${episode.code} · ${episode.title}` : '项目资产'}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground">
              {episode ? project.code : project.code}
            </div>
          </div>
          <MoreMenu
            label={episode ? '分集操作' : '项目操作'}
            actions={[
              { label: '编辑', onSelect: onEditScope },
              ...(allowDeleteScope
                ? [{ label: '删除', destructive: true, onSelect: onDeleteScope }]
                : []),
            ]}
          />
        </div>
        {(episode?.synopsis || project.description) ? (
          <p
            className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground"
            title={episode?.synopsis || project.description}
          >
            {episode?.synopsis || project.description}
          </p>
        ) : null}
      </header>

      <KindTabs basePath={basePath} counts={counts} />

      <div className="flex items-center gap-2 px-4 py-2">
        <span className="font-mono text-[11px] text-muted-foreground">{total}</span>
        <div className="ml-auto">
          {kind === 'text' ? (
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {error ? (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{error}</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={reload}>
              重试
            </Button>
          </div>
        ) : null}

        {loading && assets.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </div>
        ) : null}

        {!loading && !error && assets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-16 text-center text-xs text-muted-foreground">
            还没有{meta.label}资产
          </div>
        ) : null}

        {assets.length > 0 ? (
          <AssetList
            kind={kind}
            assets={assets}
            onPreview={setPreview}
            onEdit={setEditing}
            onDelete={setPendingDelete}
            onCopyPrompt={copyPrompt}
            onReusePrompt={reusePrompt}
          />
        ) : null}
      </div>

      <AssetPreview
        asset={preview}
        onClose={() => setPreview(null)}
        onCopyPrompt={copyPrompt}
        onReusePrompt={reusePrompt}
      />

      <AssetDialog
        open={creating || editing !== null}
        projectRef={project.code}
        episode={scope}
        asset={editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false)
            setEditing(null)
          }
        }}
        onSaved={(asset, created) => {
          notify(created ? `已创建「${asset.name}」` : '已保存')
          refresh()
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

      <Dialog
        open={copyFallback !== null}
        onOpenChange={(open) => {
          if (!open) setCopyFallback(null)
        }}
        title="复制提示词"
        description="浏览器拒绝了自动复制，文本已选中，请按 Ctrl / ⌘ + C。"
        footer={<Button onClick={() => setCopyFallback(null)}>关闭</Button>}
      >
        <textarea
          readOnly
          autoFocus
          value={copyFallback ?? ''}
          rows={6}
          className="mb-3 w-full resize-none rounded-lg border border-border bg-input p-2.5 text-sm leading-relaxed outline-none"
          onFocus={(event) => event.currentTarget.select()}
        />
      </Dialog>

      <Toast message={toast} />
    </div>
  )
}
