import { useEffect, useState, type FormEvent } from 'react'

import { ApiError, api, type Project } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Label, Textarea } from './ui/field'

interface ProjectDialogProps {
  open: boolean
  /** null 表示新建 */
  project: Project | null
  onOpenChange: (open: boolean) => void
  onSaved: (project: Project, created: boolean) => void
}

interface FormState {
  name: string
  description: string
}

const EMPTY_FORM: FormState = { name: '', description: '' }

export function ProjectDialog({ open, project, onOpenChange, onSaved }: ProjectDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = project !== null

  useEffect(() => {
    if (!open) return
    setError(null)
    setSubmitting(false)
    setForm(
      project
        ? { name: project.name, description: project.description }
        : EMPTY_FORM,
    )
  }, [open, project])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) {
      setError('项目名称不能为空')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const description = form.description.trim()
      if (project) {
        const saved = await api.projects.update(project.id, { name, description })
        onSaved(saved, false)
      } else {
        const created = await api.projects.create({ name, description })
        onSaved(created, true)
      }
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.fullMessage : '保存失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? '编辑项目' : '新建项目'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="project-form" variant="primary" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id="project-form" className="space-y-4 pb-3" onSubmit={handleSubmit} noValidate>
        <div>
          <Label htmlFor="project-name">项目名称</Label>
          <Input
            id="project-name"
            value={form.name}
            maxLength={120}
            required
            autoFocus
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>

        <div>
          <Label htmlFor="project-description">简介</Label>
          <Textarea
            id="project-description"
            value={form.description}
            maxLength={2000}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>

        <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      </form>
    </Dialog>
  )
}
