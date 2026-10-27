import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2, Plus, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

import { ApiError, api, type Project } from '@/lib/api'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { useProjects } from '@/hooks/use-projects'
import { useWorkspaceEvents } from '@/hooks/use-workspace-events'
import type { MenuAction } from './ui/more-menu'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input } from './ui/field'
import { ProjectDialog } from './project-dialog'
import { ProjectGrid, type CardOrderHelpers } from './project-grid'
import { Toast, type ToastMessage } from './toast'

export function ProjectWorkspace() {
  const { data, loading, error, query, search, reload } = useProjects()
  const navigate = useNavigate()

  // Agent / 其他标签页写入后刷新卡片（名称、封面、资产数量、排序）
  const scheduleReload = useDebouncedCallback(reload, 300)
  useWorkspaceEvents(null, scheduleReload, scheduleReload)

  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
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

  // 搜索防抖：输入停顿 250ms 后才发请求，避免每次按键都打后端
  useEffect(() => {
    const next = keyword.trim()
    if (next === query.q) return
    const timer = setTimeout(() => search(next), 250)
    return () => clearTimeout(timer)
  }, [keyword, query.q, search])

  const projects = data?.items ?? []
  const total = data?.total ?? 0
  const truncated = total > projects.length

  async function handleReorder(ids: number[]) {
    try {
      await api.projects.reorder(ids)
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '排序保存失败', 'error')
      reload()
    }
  }

  function actionsFor(project: Project, order: CardOrderHelpers): MenuAction[] {
    return [
      { label: '编辑', onSelect: () => setEditing(project) },
      {
        label: '上移',
        onSelect: () => order.move(-1),
        disabled: order.index === 0,
      },
      {
        label: '下移',
        onSelect: () => order.move(1),
        disabled: order.index === order.count - 1,
      },
      { label: '删除', onSelect: () => setPendingDelete(project), destructive: true },
    ]
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.projects.remove(pendingDelete.id)
      notify(`已删除「${pendingDelete.name}」`)
      setPendingDelete(null)
      reload()
    } catch (cause) {
      notify(cause instanceof ApiError ? cause.fullMessage : '删除失败', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {data ? `${total} 个项目 · 拖动卡片调整顺序` : '\u00a0'}
          </p>
        </div>

        <div className="relative">
          {loading ? (
            <Loader2 className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            type="search"
            value={keyword}
            placeholder="搜索名称或编号"
            aria-label="搜索项目"
            className="w-64 pl-8"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <Button
          variant="primary"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-4" />
          新建项目
        </Button>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={reload}>
            重试
          </Button>
        </div>
      ) : null}

      <ProjectGrid
        projects={projects}
        loading={loading}
        empty={!loading && !error && projects.length === 0}
        searching={query.q !== ''}
        onCreate={() => {
          setEditing(null)
          setDialogOpen(true)
        }}
        actionsFor={actionsFor}
        onOpen={(project) => navigate(`/projects/${project.code}`)}
        onReorder={handleReorder}
      />

      {truncated ? (
        <p className="text-xs text-muted-foreground">
          共 {total} 个，显示前 {projects.length} 个
        </p>
      ) : null}

      <ProjectDialog
        open={dialogOpen || editing !== null}
        project={editing}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false)
            setEditing(null)
          }
        }}
        onSaved={(project, created) => {
          notify(created ? `已创建「${project.name}」` : '已保存')
          reload()
        }}
      />

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="删除项目"
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
