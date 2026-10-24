import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api, type Episode, type Project } from '@/lib/api'
import { useEpisodes } from '@/hooks/use-episodes'
import { AssetPanel } from './asset-panel'
import { ChatPanel } from './chat-panel'
import { EpisodeDialog } from './episode-dialog'
import { EpisodeOverview } from './episode-overview'
import { isAssetKind } from './kind-tabs'
import { ProjectDialog } from './project-dialog'
import { ProjectSidebar } from './project-sidebar'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

export function ProjectPage() {
  const { ref = '' } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { episodes, loading: episodesLoading, reload: reloadEpisodes } = useEpisodes(
    project?.code ?? '',
  )

  const [editingProject, setEditingProject] = useState(false)
  const [deletingProject, setDeletingProject] = useState(false)
  const [episodeDialog, setEpisodeDialog] = useState<{ open: boolean; episode: Episode | null }>({
    open: false,
    episode: null,
  })
  const [deletingEpisode, setDeletingEpisode] = useState<Episode | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const notify = useCallback((text: string, tone: ToastMessage['tone'] = 'ok') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api.projects
      .get(ref, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setProject(result)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(cause instanceof ApiError ? cause.fullMessage : '加载项目失败')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [ref])

  async function confirmDeleteProject() {
    if (!project) return
    setBusy(true)
    try {
      await api.projects.remove(project.id)
      navigate('/', { replace: true })
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
      setBusy(false)
    }
  }

  async function confirmDeleteEpisode() {
    if (!deletingEpisode) return
    setBusy(true)
    try {
      await api.projects.episodes.remove(deletingEpisode.id)
      notify(`已删除「${deletingEpisode.code}」`)
      setDeletingEpisode(null)
      reloadEpisodes()
      navigate(`/projects/${project?.code}/episodes`, { replace: true })
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openEpisodeCreate = () => setEpisodeDialog({ open: true, episode: null })
  const openEpisodeEdit = (episode: Episode) => setEpisodeDialog({ open: true, episode })

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载中…
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error ?? '项目不存在'}</p>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          返回项目列表
        </Link>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <ProjectSidebar
        project={project}
        episodes={episodes}
        onCreateEpisode={openEpisodeCreate}
        onEditEpisode={openEpisodeEdit}
        onDeleteEpisode={setDeletingEpisode}
      />

      <section className="flex w-80 shrink-0 flex-col border-r border-border">
        <Routes>
          <Route index element={<Navigate to="assets/text" replace />} />

          <Route
            path="assets/:kind"
            element={
              <ProjectAssetRoute
                project={project}
                onEditScope={() => setEditingProject(true)}
                onDeleteScope={() => setDeletingProject(true)}
              />
            }
          />

          <Route
            path="episodes"
            element={
              <EpisodeOverview
                project={project}
                episodes={episodes}
                loading={episodesLoading}
                onCreate={openEpisodeCreate}
                onEdit={openEpisodeEdit}
                onDelete={setDeletingEpisode}
              />
            }
          />

          <Route
            path="episodes/:ep/assets/:kind"
            element={
              <EpisodeAssetRoute
                project={project}
                episodes={episodes}
                loading={episodesLoading}
                onEditEpisode={openEpisodeEdit}
                onDeleteEpisode={setDeletingEpisode}
              />
            }
          />

          <Route path="*" element={<Navigate to="assets/text" replace />} />
        </Routes>
      </section>

      <ChatPanel />

      <ProjectDialog
        open={editingProject}
        project={project}
        onOpenChange={setEditingProject}
        onSaved={(saved) => {
          setProject(saved)
          notify('已保存')
        }}
      />

      <EpisodeDialog
        open={episodeDialog.open}
        projectRef={project.code}
        episode={episodeDialog.episode}
        onOpenChange={(open) => setEpisodeDialog((prev) => ({ ...prev, open }))}
        onSaved={(episode, created) => {
          notify(created ? `已新建「${episode.code}」` : '已保存')
          reloadEpisodes()
        }}
      />

      <Dialog
        open={deletingProject}
        onOpenChange={setDeletingProject}
        title="删除项目"
        footer={
          <>
            <Button onClick={() => setDeletingProject(false)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              className="bg-destructive text-white"
              onClick={confirmDeleteProject}
              disabled={busy}
            >
              {busy ? '删除中…' : '删除'}
            </Button>
          </>
        }
      >
        <p className="pb-4 text-sm text-muted-foreground">
          确定删除「<span className="text-foreground">{project.name}</span>」吗？
        </p>
      </Dialog>

      <Dialog
        open={deletingEpisode !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingEpisode(null)
        }}
        title="删除分集"
        footer={
          <>
            <Button onClick={() => setDeletingEpisode(null)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              className="bg-destructive text-white"
              onClick={confirmDeleteEpisode}
              disabled={busy}
            >
              {busy ? '删除中…' : '删除'}
            </Button>
          </>
        }
      >
        <p className="pb-4 text-sm text-muted-foreground">
          确定删除「{deletingEpisode?.code} · {deletingEpisode?.title}」吗？其下资产会被保留。
        </p>
      </Dialog>

      <Toast message={toast} />
    </div>
  )
}

function ProjectAssetRoute({
  project,
  onEditScope,
  onDeleteScope,
}: {
  project: Project
  onEditScope: () => void
  onDeleteScope: () => void
}) {
  const { kind } = useParams()
  if (!isAssetKind(kind)) return <Navigate to="assets/text" replace />
  return (
    <AssetPanel
      project={project}
      kind={kind}
      onEditScope={onEditScope}
      onDeleteScope={onDeleteScope}
    />
  )
}

function EpisodeAssetRoute({
  project,
  episodes,
  loading,
  onEditEpisode,
  onDeleteEpisode,
}: {
  project: Project
  episodes: Episode[]
  loading: boolean
  onEditEpisode: (episode: Episode) => void
  onDeleteEpisode: (episode: Episode) => void
}) {
  const { ep, kind } = useParams()
  const episode = episodes.find((item) => item.code === ep)

  if (loading && episodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        加载中…
      </div>
    )
  }

  if (!episode) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-muted-foreground">分集不存在：{ep}</p>
        <Link
          to={`/projects/${project.code}/episodes`}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          返回分集列表
        </Link>
      </div>
    )
  }

  if (!isAssetKind(kind)) {
    return <Navigate to={`/projects/${project.code}/episodes/${episode.code}/assets/text`} replace />
  }

  return (
    <AssetPanel
      project={project}
      episode={episode}
      kind={kind}
      onEditScope={() => onEditEpisode(episode)}
      onDeleteScope={() => onDeleteEpisode(episode)}
    />
  )
}
