import { useCallback, useEffect, useRef, type Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'

import { ASSET_MIME, readAssetDrag, type AssetDragPayload } from '@/lib/asset-drag'
import { TEXT_DROP_MAX_CHARS } from '@/lib/limits'
import { ImageChip, serializePrompt, type PromptValue } from './prompt-editor'

export interface PromptInputHandle {
  clear: () => void
  focus: () => void
  setText: (text: string) => void
  /** 还原带图片块的文档 */
  setDoc: (doc: unknown) => void
  getValue: () => PromptValue
  /** 取出完整文档，用于按模式暂存草稿 */
  getDoc: () => unknown
  /** 在光标处插入纯文本（参考图编号等） */
  insertText: (text: string) => void
  /** 在光标处插入多行模板（按段落拆分，保留换行） */
  insertTemplate: (text: string) => void
}

interface PromptInputProps {
  ref?: Ref<PromptInputHandle>
  disabled?: boolean
  placeholder?: string
  maxRefs: number
  /** 视频模式下图片应拖到首尾帧槽位，禁用编辑器内的图片块 */
  allowAssetDrop?: boolean
  /** 禁用图片块时，拖入编辑器给出的提示 */
  assetDropHint?: string
  onChange: (value: PromptValue) => void
  onSubmit: () => void
  onReject?: (message: string) => void
}

const EMPTY: PromptValue = { text: '', refs: [] }

/** 富文本提示词输入：文字与图片引用块混排。 */
export function PromptInput({
  ref,
  disabled = false,
  placeholder = '描述画面',
  maxRefs,
  allowAssetDrop = true,
  assetDropHint = '图片请拖到上方的图片槽位',
  onChange,
  onSubmit,
  onReject,
}: PromptInputProps) {
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const rejectRef = useRef(onReject)
  rejectRef.current = onReject
  const maxRefsRef = useRef(maxRefs)
  maxRefsRef.current = maxRefs
  const allowDropRef = useRef(allowAssetDrop)
  allowDropRef.current = allowAssetDrop
  const assetDropHintRef = useRef(assetDropHint)
  assetDropHintRef.current = assetDropHint
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, blockquote: false }),
      Placeholder.configure({ placeholder }),
      ImageChip,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prompt-editor',
        'aria-label': '提示词',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault()
          submitRef.current()
          return true
        }
        return false
      },
      handleDOMEvents: {
        // 自己接管资产拖放：ProseMirror 默认 drop 需要 posAtCoords，拿不到位置时会直接忽略；
        // 这里用 handleDOMEvents 抢先处理，坐标缺失也能落到文档末尾。
        drop: (view, event) => handleAssetDrop(view as EditorView, event as DragEvent),
      },
      handlePaste: (_view, event) => {
        // 只接受纯文本，避免外部 HTML 带进样式
        const text = event.clipboardData?.getData('text/plain')
        if (!text) return false
        event.preventDefault()
        editor?.commands.insertContent({ type: 'text', text })
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      renumber(current)
      changeRef.current(serializePrompt(current.state.doc))
    },
  })

  function currentRefs(): number {
    if (!editor) return 0
    return serializePrompt(editor.state.doc).refs.length
  }

  function handleAssetDrop(view: EditorView, event: DragEvent): boolean {
    const raw = event.dataTransfer?.getData(ASSET_MIME)
    if (!raw) return false
    event.preventDefault()
    if (disabledRef.current) return true
    const payload = readAssetDrag(event.dataTransfer)
    if (!payload) return true
    // 文本资产：无论图片块是否禁用（视频模式）都应能整段插入
    if (payload.kind === 'text') {
      insertDroppedText(payload.text ?? '', dropPosition(view, event))
      return true
    }
    if (!allowDropRef.current) {
      rejectRef.current?.(assetDropHintRef.current)
      return true
    }
    if (payload.kind !== 'image') {
      rejectRef.current?.('这里只支持图片引用；视频请拖到首/尾帧，音频请拖到参考素材区')
      return true
    }
    insertChip(payload, dropPosition(view, event))
    return true
  }

  function insertChip(payload: AssetDragPayload, pos: number) {
    if (!editor) return
    if (!payload.assetId || !payload.src) return
    if (currentRefs() >= maxRefsRef.current) {
      rejectRef.current?.(`最多引用 ${maxRefsRef.current} 张图片`)
      return
    }
    editor
      .chain()
      .focus()
      .insertContentAt(pos, {
        type: 'imageChip',
        attrs: { assetId: payload.assetId, src: payload.src, label: '图' },
      })
      .run()
    renumber(editor)
    changeRef.current(serializePrompt(editor.state.doc))
  }

  function insertDroppedText(rawText: string, pos: number) {
    if (!editor) return
    const text = rawText.replace(/\r\n?/g, '\n')
    const clipped = text.slice(0, TEXT_DROP_MAX_CHARS)
    editor.chain().focus().insertContentAt(pos, textToContent(clipped)).run()
    renumber(editor)
    changeRef.current(serializePrompt(editor.state.doc))
    if (clipped.length < text.length) {
      // 不静默丢内容：明确告诉用户插入了多少
      rejectRef.current?.(`文本 ${text.length} 字符，已插入前 ${TEXT_DROP_MAX_CHARS} 字符`)
    }
  }

  const setText = useCallback(
    (text: string) => {
      editor?.commands.setContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
      })
      if (editor) changeRef.current(serializePrompt(editor.state.doc))
    },
    [editor],
  )

  useEffect(() => {
    if (ref && typeof ref === 'object') {
      ref.current = {
        clear: () => editor?.commands.clearContent(true),
        focus: () => editor?.commands.focus(),
        setText,
        setDoc: (doc) => {
          editor?.commands.setContent(doc as never)
          if (editor) changeRef.current(serializePrompt(editor.state.doc))
        },
        getValue: () => (editor ? serializePrompt(editor.state.doc) : EMPTY),
        getDoc: () => editor?.getJSON() ?? null,
        insertText: (text) => {
          if (!editor) return
          // 用文本节点插入，避免 <Picture 1> 被当成 HTML 解析
          editor.chain().focus().insertContent({ type: 'text', text }).run()
          changeRef.current(serializePrompt(editor.state.doc))
        },
        insertTemplate: (text) => {
          if (!editor) return
          editor.chain().focus().insertContent(paragraphs(text.replace(/\r\n?/g, '\n'))).run()
          changeRef.current(serializePrompt(editor.state.doc))
        },
      }
    }
  }, [ref, editor, setText])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return <EditorContent editor={editor} />
}

/** 按段落拆分：空行保留为空段落，避免拖入的剧本丢换行。 */
function paragraphs(text: string) {
  return text.split('\n').map((line) =>
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
  )
}

/** 单行文本按行内文字插入（不打断当前句子），多行按段落插入。 */
function textToContent(text: string) {
  return text.includes('\n') ? paragraphs(text) : { type: 'text', text }
}

/**
 * 拖放落点：优先用鼠标坐标换算光标位置；拿不到布局信息时（如 jsdom）退回文档末尾，
 * 并且必须落在文本块内部，否则行内节点插入会被 schema 拒绝。
 */
function dropPosition(view: EditorView, event: DragEvent): number {
  try {
    const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
    if (coords && coords.pos > 0) return coords.pos
  } catch {
    // 没有布局信息，走末尾兜底
  }
  return Math.max(1, view.state.doc.content.size - 1)
}

/** 按出现顺序把引用块编号成「图1」「图2」… */
function renumber(editor: { state: { doc: any; tr: any }; view: { dispatch: (tr: any) => void } }) {
  let index = 0
  const transaction = editor.state.tr
  editor.state.doc.descendants((node: any, pos: number) => {
    if (node.type.name !== 'imageChip') return
    index += 1
    const label = `图${index}`
    if (node.attrs.label !== label) {
      transaction.setNodeMarkup(pos, undefined, { ...node.attrs, label })
    }
  })
  if (transaction.docChanged) editor.view.dispatch(transaction)
}
