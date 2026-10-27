import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { api, type HealthInfo } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AppHeader, BrandMark } from './components/app-header'
import { ProjectPage } from './components/project-page'
import { ProjectWorkspace } from './components/project-workspace'
import { TaskQueue } from './components/task-queue'

function ConnectionStatus() {
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal)
      .then((info) => {
        if (!controller.signal.aborted) setHealth(info)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [])

  const label = failed ? '后端未连接' : health ? 'ComfyUI 已连接' : '连接中'
  return (
    <span className="mr-2 hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
      <span
        className={cn(
          'size-1.5 rounded-full',
          failed ? 'bg-destructive' : health ? 'bg-emerald-500' : 'animate-pulse bg-amber-500',
        )}
      />
      {label}
    </span>
  )
}

function HomePage() {
  return (
    <div className="flex h-full flex-col">
      <AppHeader actions={<ConnectionStatus />}>
        <BrandMark />
      </AppHeader>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-8 pt-10 pb-16">
          <ProjectWorkspace />
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects/:ref/s/:sessionId/*" element={<ProjectPage />} />
        <Route path="/projects/:ref/*" element={<ProjectPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <TaskQueue />
    </>
  )
}
