import { useEffect, useState, type FormEvent } from 'react'

import { ApiError, api, type Episode } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Label, Textarea } from './ui/field'

interface EpisodeDialogProps {
  open: boolean
  projectRef: string
  /** 传入表示编辑；不传为新建 */
  episode?: Episode | null
  onOpenChange: (open: boolean) => void
  onSaved: (episode: Episode, created: boolean) => void
}

export function EpisodeDialog({
  open,
  projectRef,
  episode = null,
  onOpenChange,
  onSaved,
}: EpisodeDialogProps) {
  const [title, setTitle] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = episode !== null

  useEffect(() => {
    if (!open) return
    setTitle(episode?.title ?? '')
    setSynopsis(episode?.synopsis ?? '')
    setError(null)
    setSubmitting(false)
  }, [open, episode])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      if (episode) {
        const saved = await api.projects.episodes.update(episode.id, {
          title: title.trim() || episode.title,
          synopsis,
        })
        onSaved(saved, false)
      } else {
        const created = await api.projects.episodes.create(projectRef, {
          ...(title.trim() ? { title: title.trim() } : {}),
          synopsis,
        })
        onSaved(created, true)
      }
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.fullMessage : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? '编辑分集' : '新建分集'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="episode-form" variant="primary" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id="episode-form" className="space-y-4 pb-3" onSubmit={handleSubmit} noValidate>
        <div>
          <Label htmlFor="episode-title">标题</Label>
          <Input
            id="episode-title"
            value={title}
            maxLength={200}
            autoFocus
            placeholder={episode ? undefined : '留空自动命名「第 N 集」'}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="episode-synopsis">简介</Label>
          <Textarea
            id="episode-synopsis"
            value={synopsis}
            maxLength={5000}
            className="min-h-28"
            onChange={(event) => setSynopsis(event.target.value)}
          />
        </div>
        <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      </form>
    </Dialog>
  )
}
