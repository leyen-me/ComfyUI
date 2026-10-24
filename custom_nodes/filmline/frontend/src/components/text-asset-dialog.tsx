import { useEffect, useState, type FormEvent } from 'react'

import { ApiError, api, type Asset } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Label, Textarea } from './ui/field'

interface TextAssetDialogProps {
  open: boolean
  projectRef: string
  onOpenChange: (open: boolean) => void
  onCreated: (asset: Asset) => void
}

export function TextAssetDialog({
  open,
  projectRef,
  onOpenChange,
  onCreated,
}: TextAssetDialogProps) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setContent('')
    setError(null)
    setSubmitting(false)
  }, [open])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const asset = await api.projects.assets.createText(projectRef, {
        name: name.trim(),
        content,
      })
      onCreated(asset)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.fullMessage : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="新建文本"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="text-asset-form" variant="primary" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </Button>
        </>
      }
    >
      <form id="text-asset-form" className="space-y-4 pb-3" onSubmit={handleSubmit} noValidate>
        <div>
          <Label htmlFor="asset-name">名称</Label>
          <Input
            id="asset-name"
            value={name}
            maxLength={200}
            autoFocus
            required
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="asset-content">内容</Label>
          <Textarea
            id="asset-content"
            value={content}
            className="min-h-40"
            maxLength={200_000}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
        <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      </form>
    </Dialog>
  )
}
