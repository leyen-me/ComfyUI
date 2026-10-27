import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Loader2 } from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api, type Episode, type Project } from '@/lib/api'
import { emitAssetsChanged, type AssetsChangedDetail } from '@/lib/events'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { useEpisodes } from '@/hooks/use-episodes'
import { useWorkspaceEvents } from '@/hooks/use-workspace-events'
import { mobileProjectTab, projectSection, type MobileProjectTab } from '@/lib/layout'
import { cn } from '@/lib/utils'
import type { WorkspaceEvent } from '@/lib/workspace-events'
import { AppHeader, BrandMark } from './app-header'
import { AssetPanel } from './asset-panel'
import { AgentPanel } from './agent-panel'
import { EpisodeDialog } from './episode-dialog'
import { EpisodeOverview } from './episode-overview'
import { isAssetKind } from './kind-tabs'
import { MobileProjectNav } from './mobile-project-nav'
import { ProjectDialog } from './project-dialog'
import { ProjectSidebar } from './project-sidebar'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

export function ProjectPage() {
  const { ref = '', sessionId: sessionParam } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const projectCode = ref
  // 切换会话时把 session 写进 path，保留当前资产/分集位置
  const handleSessionChange = useCallback(
    (next: number | null) => {
      const prefix = `/projects/${projectCode}`
      let rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : ''
      if (rest.startsWith('/s/')) {
        const segments = rest.split('/').filter(Boolean)
        rest = segments.length > 2 ? `/${segments.slice(2).join('/')}` : ''
      }
      const base = next ? `${prefix}/s/${next}` : prefix
      navigate(`${base}${rest}`, { replace: true })
    },
    [navigate, pathname, projectCode],
  )
  const sessionId = /^\d+$/.test(sessionParam ?? '') ? Number(sessionParam) : undefined
  const basePath = `/projects/${projectCode}${sessionId ? `/s/${sessionId}` : ''}`
  // 生成产物要落到当前作用域：在分集里就归到该集。
  // 路径可能是 /projects/PRJ/assets/... 或 /projects/PRJ/s/1/assets/...
  const parts = pathname.split('/').filter(Boolean)
  const offset = parts[2] === 's' ? 4 : 2
  const episodeCode = parts[offset] === 'episodes' ? parts[offset + 1] : undefined

  // 手机端一次只显示一栏：资产（含分集列表）或 Agent。
  // 路由变化到资产/分集时自动回到资产栏，避免从任务队列跳转后仍停在助手上。
  const section = projectSection(pathname, basePath)
  // 切换会话只会改变 /s/:id，不应把用户从助手页踢回资产页；
  // 其他路径变化（任务队列跳转、选择分集等）才回到资产栏。
  const routeKey = pathname.replace(/\/s\/\d+(?=\/|$)/, '')
  const [mobilePane, setMobilePane] = useState<'assets' | 'agent'>('assets')
  const mobileTab = mobileProjectTab(section, mobilePane)

  useEffect(() => {
    if (section !== 'other') setMobilePane('assets')
  }, [section, routeKey])

  const selectMobileTab = useCallback(
    (tab: MobileProjectTab) => {
      if (tab === 'agent') {
        setMobilePane('agent')
        return
      }
      setMobilePane('assets')
      if (tab === 'episodes') {
        navigate(`${basePath}/episodes`)
        return
      }
      if (section === 'other' || section === 'episode-list') {
        navigate(`${basePath}/assets/text`)
      }
    },
    [basePath, navigate, section],
  )

  const [project, setProject] = useState<Project | null>(null)
  const [projectVersion, setProjectVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { episodes, loading: episodesLoading, reload: reloadEpisodes } = useEpisodes(
    project?.code ?? '',
  )

  const [editingProject, setEditingProject] = useState(false)
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
    // 切换项目时清掉旧数据，避免顶部面包屑短暂显示上一个项目
    setProject(null)
    setLoading(true)
    setError(null)
  }, [ref])

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
  }, [ref, projectVersion])

  const reloadProject = useCallback(() => setProjectVersion((value) => value + 1), [])

  // Agent / 其他标签页写入后，按项目做一次合并刷新
  const pendingAssets = useRef<AssetsChangedDetail | undefined>(undefined)
  const refreshFromWorkspace = useDebouncedCallback(() => {
    const detail = pendingAssets.current
    pendingAssets.current = undefined
    reloadProject()
    reloadEpisodes()
    emitAssetsChanged(detail)
  }, 250)

  const handleWorkspaceEvent = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type === 'projects') return
      if (event.type === 'project' && event.action === 'deleted') {
        notify('项目已被删除', 'error')
        navigate('/', { replace: true })
        return
      }
      if (event.type === 'assets') {
        pendingAssets.current = {
          projectId: event.project_id,
          episodeId: event.episode_id,
          action: event.action,
          assetIds: event.asset_ids,
        }
      }
      refreshFromWorkspace()
    },
    [navigate, notify, refreshFromWorkspace],
  )

  useWorkspaceEvents(ref, handleWorkspaceEvent, refreshFromWorkspace)

  async function confirmDeleteEpisode() {
    if (!deletingEpisode) return
    setBusy(true)
    try {
      await api.projects.episodes.remove(deletingEpisode.id)
      notify(`已删除「${deletingEpisode.code}」`)
      setDeletingEpisode(null)
      reloadEpisodes()
      navigate(`${basePath}/episodes`, { replace: true })
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const openEpisodeCreate = () => setEpisodeDialog({ open: true, episode: null })
  const openEpisodeEdit = (episode: Episode) => setEpisodeDialog({ open: true, episode })

  if (loading && !project) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载中…
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error ?? '项目不存在'}</p>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          返回项目列表
        </Link>
      </div>
    )
  }

  const currentEpisode = episodes.find((item) => item.code === episodeCode)

  return (
    <div className="flex h-full flex-col">
      <AppHeader>
        <BrandMark compact />
        <nav
          aria-label="位置"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"
        >
          <Link
            to="/"
            className="hidden shrink-0 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
          >
            项目
          </Link>
          <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/50 sm:block" />
          <Link
            to={basePath}
            className={cn(
              'min-w-0 truncate rounded-md px-1.5 py-1 transition-colors',
              currentEpisode
                ? 'text-muted-foreground hover:bg-muted hover:text-foreground'
                : 'font-medium text-foreground',
              // 手机上分集标题本身较长，隐藏上一级项目名，把宽度留给当前分集
              currentEpisode && 'hidden sm:inline',
            )}
            title={project.name}
          >
            {project.name}
          </Link>
          {currentEpisode ? (
            <>
              <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground/50 sm:block" />
              <span className="min-w-0 truncate px-1.5 font-medium" title={currentEpisode.title}>
                <span className="mr-1.5 font-mono text-[11px] text-primary">
                  {currentEpisode.code}
                </span>
                {currentEpisode.title}
              </span>
            </>
          ) : null}
        </nav>
      </AppHeader>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="hidden min-h-0 lg:flex">
          <ProjectSidebar
            episodes={episodes}
            basePath={basePath}
            onCreateEpisode={openEpisodeCreate}
            onEditEpisode={openEpisodeEdit}
            onDeleteEpisode={setDeletingEpisode}
          />
        </div>

        <section
          className={cn(
            'min-h-0 w-full flex-1 flex-col border-border bg-card/40 lg:flex lg:w-[22rem] lg:flex-none lg:border-r',
            mobileTab === 'agent' ? 'hidden' : 'flex',
          )}
        >
          <Routes>
            <Route index element={<Navigate to="assets/text" replace />} />

            <Route
              path="assets/:kind"
              element={
                <ProjectAssetRoute
                  project={project}
                  onEditScope={() => setEditingProject(true)}
                />
              }
            />

            <Route
              path="episodes"
              element={
                <EpisodeOverview
                  episodes={episodes}
                  basePath={basePath}
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
                  basePath={basePath}
                  loading={episodesLoading}
                  onEditEpisode={openEpisodeEdit}
                  onDeleteEpisode={setDeletingEpisode}
                />
              }
            />

            <Route path="*" element={<Navigate to="assets/text" replace />} />
          </Routes>
        </section>

        <div
          className={cn(
            'min-h-0 min-w-0 flex-1',
            mobileTab === 'agent' ? 'flex' : 'hidden lg:flex',
          )}
        >
          <AgentPanel
            project={project}
            sessionId={sessionId}
            onSessionChange={handleSessionChange}
          />
        </div>
      </div>

      <MobileProjectNav
        active={mobileTab}
        episodeCount={episodes.length}
        onSelect={selectMobileTab}
      />

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
}: {
  project: Project
  onEditScope: () => void
}) {
  const { kind } = useParams()
  if (!isAssetKind(kind)) return <Navigate to="assets/text" replace />
  return (
    <AssetPanel
      project={project}
      kind={kind}
      onEditScope={onEditScope}
      onDeleteScope={() => undefined}
      allowDeleteScope={false}
    />
  )
}

function EpisodeAssetRoute({
  project,
  episodes,
  basePath,
  loading,
  onEditEpisode,
  onDeleteEpisode,
}: {
  project: Project
  episodes: Episode[]
  basePath: string
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
          to={`${basePath}/episodes`}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          返回分集列表
        </Link>
      </div>
    )
  }

  if (!isAssetKind(kind)) {
    return <Navigate to={`${basePath}/episodes/${episode.code}/assets/text`} replace />
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
