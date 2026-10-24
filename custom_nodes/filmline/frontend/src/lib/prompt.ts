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

export interface RefAsset {
  assetId: number
  src: string
}

export interface PromptDocJson {
  type: 'doc'
  content: Array<{ type: 'paragraph'; content?: Array<Record<string, unknown>> }>
}

/**
 * 把已保存的提示词文本还原成带图片块的文档。
 * 文本里的「图N」按顺序对应 refs[N-1]；找不到对应资产时保留为普通文字。
 */
export function buildPromptDoc(
  text: string,
  refs: Array<RefAsset | null>,
): PromptDocJson {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => {
      const nodes: Array<Record<string, unknown>> = []
      for (const token of line.split(/(图\d+)/g)) {
        if (!token) continue
        const matched = /^图(\d+)$/.exec(token)
        const ref = matched ? (refs[Number(matched[1]) - 1] ?? undefined) : undefined
        if (ref) {
          nodes.push({
            type: 'imageChip',
            attrs: { assetId: ref.assetId, src: ref.src, label: token },
          })
        } else {
          nodes.push({ type: 'text', text: token })
        }
      }
      return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' }
    }),
  }
}
