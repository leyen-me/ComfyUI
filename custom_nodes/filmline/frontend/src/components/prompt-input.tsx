import { useCallback, useEffect, useRef, type Ref } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Placeholder from '@tiptap/extension-placeholder'
import StarterKit from '@tiptap/starter-kit'

import { ImageChip, serializePrompt, type PromptValue } from './prompt-editor'

export interface PromptInputHandle {
  clear: () => void
  focus: () => void
  setText: (text: string) => void
  getValue: () => PromptValue
}

interface PromptInputProps {
  ref?: Ref<PromptInputHandle>
  disabled?: boolean
  placeholder?: string
  maxRefs: number
  onChange: (value: PromptValue) => void
  onSubmit: () => void
  onReject?: (message: string) => void
}

const ASSET_MIME = 'application/x-filmline-asset'

interface DraggedAsset {
  assetId: number
  src: string
  name: string
}

const EMPTY: PromptValue = { text: '', refs: [] }

/** 富文本提示词输入：文字与图片引用块混排。 */
export function PromptInput({
  ref,
  disabled = false,
  placeholder = '描述画面',
  maxRefs,
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
      handleDrop: (view, event) => {
        const raw = event.dataTransfer?.getData(ASSET_MIME)
        if (!raw) return false
        event.preventDefault()
        let payload: DraggedAsset
        try {
          payload = JSON.parse(raw) as DraggedAsset
        } catch {
          return true
        }
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        insertChip(payload, coords?.pos ?? view.state.doc.content.size)
        return true
      },
      handlePaste: (_view, event) => {
        // 只接受纯文本，避免外部 HTML 带进样式
        const text = event.clipboardData?.getData('text/plain')
        if (!text) return false
        event.preventDefault()
        editor?.commands.insertContent(text)
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

  function insertChip(payload: DraggedAsset, pos: number) {
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
        getValue: () => (editor ? serializePrompt(editor.state.doc) : EMPTY),
      }
    }
  }, [ref, editor, setText])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  return <EditorContent editor={editor} />
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
