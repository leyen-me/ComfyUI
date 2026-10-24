export interface PromptValue {
  /** 提示词文本，图片引用已替换为「图N」 */
  text: string
  /** 按出现顺序排列的资产 id */
  refs: number[]
}

interface PromptNode {
  type: { name: string }
  attrs?: { assetId?: number | null }
  text?: string
}

interface PromptBlock {
  forEach: (fn: (node: PromptNode) => void) => void
}

interface PromptDoc {
  forEach: (fn: (block: PromptBlock) => void) => void
}

/**
 * 把编辑器文档序列化成（文本, 参考图 id 列表）。
 * 引用块按出现顺序编号成「图1」「图2」，后端据此把 images.image_N 对上。
 */
export function serializePrompt(doc: PromptDoc): PromptValue {
  const parts: string[] = []
  const refs: number[] = []

  doc.forEach((block) => {
    block.forEach((node) => {
      if (node.type.name === 'imageChip') {
        refs.push(Number(node.attrs?.assetId))
        parts.push(`图${refs.length}`)
      } else if (typeof node.text === 'string') {
        parts.push(node.text)
      }
    })
    parts.push('\n')
  })

  return { text: parts.join('').replace(/\n+$/, '').trim(), refs }
}
