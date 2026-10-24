import { useEffect, useRef, useState, type DragEvent } from 'react'

import type { Project } from '@/lib/api'
import type { MenuAction } from './ui/more-menu'
import { ProjectCard } from './project-card'

interface ProjectGridProps {
  projects: Project[]
  loading: boolean
  empty: boolean
  actionsFor: (project: Project, order: CardOrderHelpers) => MenuAction[]
  onOpen: (project: Project) => void
  onReorder: (ids: number[]) => void
}

export interface CardOrderHelpers {
  index: number
  count: number
  /** 在当前顺序里上移/下移一位（键盘可用的排序方式） */
  move: (delta: number) => void
}

const GRID = 'grid gap-4 sm:grid-cols-2 xl:grid-cols-3'

function sameIds(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

function SkeletonCards() {
  return (
    <>
      {[0, 1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="rounded-xl border border-border bg-card p-4">
          <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-3.5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-2.5 w-full animate-pulse rounded bg-muted" />
          <div className="mt-1.5 h-2.5 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-2.5 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </>
  )
}

export function ProjectGrid({
  projects,
  loading,
  empty,
  actionsFor,
  onOpen,
  onReorder,
}: ProjectGridProps) {
  /*
   * 本地只保留「id 的顺序」，卡片数据每次渲染都从 props 里取。
   * 早先这里缓存了整份 Project 对象，导致改名后 id 顺序没变、判断成“没变化”，
   * 界面上一直是旧名称，必须刷新浏览器才更新。
   */
  const [order, setOrder] = useState<number[]>(() => projects.map((project) => project.id))
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const draggingRef = useRef<number | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order

  // 数据变化时对齐顺序：保留已有次序，剔除消失的，新增的追加到末尾
  useEffect(() => {
    const incoming = projects.map((project) => project.id)
    setOrder((prev) => {
      const kept = prev.filter((id) => incoming.includes(id))
      const added = incoming.filter((id) => !kept.includes(id))
      const next = [...kept, ...added]
      return sameIds(prev, next) ? prev : next
    })
  }, [projects])

  const byId = new Map(projects.map((project) => [project.id, project]))
  const items = order.flatMap((id) => {
    const project = byId.get(id)
    return project ? [project] : []
  })

  function handleDragStart(event: DragEvent<HTMLElement>, project: Project) {
    draggingRef.current = project.id
    setDraggingId(project.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(project.id))
  }

  function handleDragEnter(project: Project) {
    const fromId = draggingRef.current
    if (fromId === null || fromId === project.id) return

    // 拖过谁就插到谁的位置，实时预览最终顺序
    setOrder((prev) => {
      const fromIndex = prev.indexOf(fromId)
      const toIndex = prev.indexOf(project.id)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev

      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      if (moved === undefined) return prev
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleDragEnd() {
    const fromId = draggingRef.current
    draggingRef.current = null
    setDraggingId(null)
    if (fromId === null) return

    if (!sameIds(orderRef.current, projects.map((project) => project.id))) {
      onReorder(orderRef.current)
    }
  }

  function move(index: number, delta: number) {
    const current = orderRef.current
    const target = index + delta
    if (target < 0 || target >= current.length) return

    const next = [...current]
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)

    setOrder(next)
    onReorder(next)
  }

  if (empty) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-20 text-center text-sm text-muted-foreground">
        还没有项目
      </div>
    )
  }

  return (
    <div className={GRID}>
      {loading && items.length === 0 ? <SkeletonCards /> : null}

      {items.map((project, index) => (
        <ProjectCard
          key={project.id}
          project={project}
          dragging={draggingId === project.id}
          actions={actionsFor(project, {
            index,
            count: items.length,
            move: (delta) => move(index, delta),
          })}
          onOpen={() => onOpen(project)}
          drag={{
            onDragStart: (event) => handleDragStart(event, project),
            onDragEnter: () => handleDragEnter(project),
            onDragOver: handleDragOver,
            onDragEnd: handleDragEnd,
          }}
        />
      ))}
    </div>
  )
}
