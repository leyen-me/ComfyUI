import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'

import { Button } from './ui/button'

/**
 * 右侧对话输入框。目前只做输入与提交动作，消息发送尚未接入后端。
 */
export function ChatPanel() {
  const [value, setValue] = useState('')

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!value.trim()) return
    // 消息通道待接：这里先清空输入，避免留下半截状态
    setValue('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex-1" />

      <form onSubmit={submit} className="border-t border-border p-3">
        <div className="rounded-xl border border-border bg-input p-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
          <textarea
            value={value}
            rows={3}
            placeholder="输入消息"
            aria-label="消息输入"
            className="w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70"
            onKeyDown={onKeyDown}
            onChange={(event) => setValue(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              size="icon"
              variant="primary"
              className="size-7 rounded-lg"
              aria-label="发送"
              disabled={!value.trim()}
            >
              <ArrowUp className="size-3.5" />
            </Button>
          </div>
        </div>
      </form>
    </aside>
  )
}
