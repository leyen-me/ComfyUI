import { useEffect, useState } from 'react'

import { api, type HealthInfo } from '@/lib/api'
import { applyTheme, readTheme, type Theme } from '@/lib/theme'
import { AppSidebar } from './components/app-sidebar'
import { ProjectWorkspace } from './components/project-workspace'

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [healthFailed, setHealthFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api.health(controller.signal)
      .then((info) => {
        if (!controller.signal.aborted) setHealth(info)
      })
      .catch(() => {
        if (!controller.signal.aborted) setHealthFailed(true)
      })
    return () => controller.abort()
  }, [])

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
  }

  return (
    <div className="flex h-full">
      <AppSidebar
        theme={theme}
        onToggleTheme={toggleTheme}
        health={health}
        healthFailed={healthFailed}
      />

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <h1 className="mb-6 text-xl font-semibold tracking-tight">项目</h1>
          <ProjectWorkspace />
        </div>
      </main>
    </div>
  )
}
