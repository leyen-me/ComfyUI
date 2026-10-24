import { Copy, RotateCcw } from 'lucide-react'

import type { Asset } from '@/lib/api'
import { assetDimensions, assetPrompt, generationMeta } from '@/lib/asset-meta'
import { formatSeconds, formatTime } from '@/lib/format'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

interface AssetPreviewProps {
  asset: Asset | null
  onClose: () => void
  onCopyPrompt: (prompt: string) => void
  onReusePrompt: (asset: Asset) => void
}

/** 大图预览：图片按屏幕高度缩放，同时展示可复用的生成参数。 */
export function AssetPreview({ asset, onClose, onCopyPrompt, onReusePrompt }: AssetPreviewProps) {
  const prompt = asset ? assetPrompt(asset) : null
  const dimensions = asset ? assetDimensions(asset) : null
  const meta = asset ? generationMeta(asset) : {}

  return (
    <Dialog
      open={asset !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={asset?.name ?? '预览'}
      className="w-[min(1100px,94vw)]"
      footer={
        <>
          {prompt ? (
            <Button onClick={() => onCopyPrompt(prompt)}>
              <Copy className="size-3.5" />
              复制提示词
            </Button>
          ) : null}
          {prompt && asset ? (
            <Button variant="primary" onClick={() => onReusePrompt(asset)}>
              <RotateCcw className="size-3.5" />
              用此提示词生成
            </Button>
          ) : null}
          <Button onClick={onClose}>关闭</Button>
        </>
      }
    >
      {asset ? (
        <div className="max-h-[72vh] space-y-3 overflow-y-auto pb-3">
          {asset.kind === 'image' ? (
            <img
              src={asset.content_url ?? ''}
              alt={asset.name}
              className="mx-auto max-h-[58vh] w-auto max-w-full rounded-lg bg-black/30 object-contain"
            />
          ) : (
            <video
              src={asset.content_url ?? ''}
              controls
              autoPlay
              className="mx-auto max-h-[58vh] w-auto max-w-full rounded-lg bg-black"
            />
          )}

          {dimensions || meta.seed !== undefined ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
              {dimensions ? <span>{dimensions}</span> : null}
              {meta.seed !== undefined ? <span>seed {meta.seed}</span> : null}
              {meta.steps !== undefined ? <span>{meta.steps} steps</span> : null}
              {meta.duration !== undefined ? <span>{meta.duration}s</span> : null}
              {asset.gen_started_at ? <span>开始 {formatTime(asset.gen_started_at)}</span> : null}
              {asset.gen_elapsed_ms
                ? <span>耗时 {formatSeconds(asset.gen_elapsed_ms / 1000)}</span>
                : null}
            </div>
          ) : null}

          {prompt ? (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">提示词</div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{prompt}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div />
      )}
    </Dialog>
  )
}
