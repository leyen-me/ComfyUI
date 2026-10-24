import { useEffect, useState, type FormEvent } from 'react'

import { ApiError, api, type Asset } from '@/lib/api'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { Input, Label, Textarea } from './ui/field'

interface AssetDialogProps {
  open: boolean
  projectRef: string
  /** 分集编号；为空表示项目级 */
  episode?: string
  /** 传入表示编辑；不传则是新建文本资产 */
  asset?: Asset | null
  onOpenChange: (open: boolean) => void
  onSaved: (asset: Asset, created: boolean) => void
}

export function AssetDialog({
  open,
  projectRef,
  episode,
  asset = null,
  onOpenChange,
  onSaved,
}: AssetDialogProps) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEdit = asset !== null
  // 只有文本资产有可编辑的正文
  const showContent = !asset || asset.kind === 'text'

  useEffect(() => {
    if (!open) return
    setName(asset?.name ?? '')
    setContent(asset?.text_content ?? '')
    setError(null)
    setSubmitting(false)
  }, [open, asset])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('名称不能为空')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (asset) {
        const saved = await api.projects.assets.update(asset.id, {
          name: name.trim(),
          ...(showContent ? { text_content: content } : {}),
        })
        onSaved(saved, false)
      } else {
        const created = await api.projects.assets.createText(
          projectRef,
          { name: name.trim(), content },
          episode,
        )
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
      title={isEdit ? '编辑资产' : '新建文本'}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="asset-form" variant="primary" disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <form id="asset-form" className="space-y-4 pb-3" onSubmit={handleSubmit} noValidate>
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

        {showContent ? (
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
        ) : null}

        <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
      </form>
    </Dialog>
  )
}
