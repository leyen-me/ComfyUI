import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api, type Project } from '@/lib/api'
import { useAssetCounts } from '@/hooks/use-assets'
import { AssetView } from './asset-view'
import { ChatPanel } from './chat-panel'
import { ProjectSidebar } from './project-sidebar'
import { ProjectDialog } from './project-dialog'
import { Toast, type ToastMessage } from './toast'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { MoreMenu } from './ui/more-menu'

export function ProjectPage() {
  const { ref = '' } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [countsVersion, setCountsVersion] = useState(0)
  const [editing, setEditing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  const counts = useAssetCounts(project?.code ?? '', countsVersion)

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

  async function confirmDelete() {
    if (!project) return
    setDeleting(true)
    try {
      await api.projects.remove(project.id)
      navigate('/', { replace: true })
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
      setDeleting(false)
    }
  }

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
      <ProjectSidebar project={project} counts={counts} />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-sm font-medium">{project.name}</h1>
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {project.code}
              </span>
            </div>
            {project.description ? (
              <p className="truncate text-xs text-muted-foreground" title={project.description}>
                {project.description}
              </p>
            ) : null}
          </div>

          <div className="ml-auto">
            <MoreMenu
              label="项目操作"
              actions={[
                { label: '编辑', onSelect: () => setEditing(true) },
                {
                  label: '删除',
                  onSelect: () => setPendingDelete(true),
                  destructive: true,
                },
              ]}
            />
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <Routes>
            <Route index element={<Navigate to="assets/text" replace />} />
            <Route
              path="assets/:kind"
              element={
                <AssetView
                  project={project}
                  onChanged={() => setCountsVersion((value) => value + 1)}
                />
              }
            />
            <Route path="*" element={<Navigate to="assets/text" replace />} />
          </Routes>
        </div>
      </section>

      <ChatPanel />

      <ProjectDialog
        open={editing}
        project={project}
        onOpenChange={setEditing}
        onSaved={(saved) => {
          setProject(saved)
          notify('已保存')
        }}
      />

      <Dialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        title="删除项目"
        footer={
          <>
            <Button onClick={() => setPendingDelete(false)} disabled={deleting}>
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
          确定删除「<span className="text-foreground">{project.name}</span>」吗？
        </p>
      </Dialog>

      <Toast message={toast} />
    </div>
  )
}
