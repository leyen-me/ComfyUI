import { Node, mergeAttributes } from '@tiptap/core'

import { serializePrompt, type PromptValue } from '@/lib/prompt'

export { serializePrompt }
export type { PromptValue }

export interface ImageChipAttrs {
  assetId: number
  src: string
  label: string
}

/**
 * 提示词里的图片引用块（原子节点）：整体删除、可拖动，前后可继续输入文字。
 * 序列化时按出现顺序替换成「图1」「图2」，并把 assetId 收集为参考图列表。
 */
export const ImageChip = Node.create({
  name: 'imageChip',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      assetId: { default: null },
      src: { default: '' },
      label: { default: '图1' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-image-chip]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-image-chip': '',
        'data-asset-id': String(node.attrs.assetId ?? ''),
        class: 'prompt-chip',
        title: node.attrs.label,
      }),
      ['img', { src: node.attrs.src, class: 'prompt-chip-img', alt: node.attrs.label }],
      ['span', { class: 'prompt-chip-label' }, String(node.attrs.label)],
    ]
  },
})
