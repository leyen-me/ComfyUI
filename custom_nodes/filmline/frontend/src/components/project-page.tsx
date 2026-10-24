import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError, api, type Project } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { MoreMenu } from './ui/more-menu'
import { ProjectDialog } from './project-dialog'
import { Toast, type ToastMessage } from './toast'

export function ProjectPage() {
  const { ref = '' } = useParams()
  const navigate = useNavigate()

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
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
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载中…
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-sm text-destructive">{error ?? '项目不存在'}</p>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 inline size-3.5" />
          返回项目列表
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/"
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        项目
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-xs text-muted-foreground">{project.code}</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{project.name}</h1>
        </div>
        <MoreMenu
          actions={[
            { label: '编辑', onSelect: () => setEditing(true) },
            { label: '删除', onSelect: () => setPendingDelete(true), destructive: true },
          ]}
          label="项目操作"
        />
      </div>

      {project.description ? (
        <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {project.description}
        </p>
      ) : null}

      <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-5 text-xs">
        <div>
          <dt className="text-muted-foreground">创建时间</dt>
          <dd className="mt-1 font-mono">{formatTime(project.created_at)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">更新时间</dt>
          <dd className="mt-1 font-mono">{formatTime(project.updated_at)}</dd>
        </div>
      </dl>

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
