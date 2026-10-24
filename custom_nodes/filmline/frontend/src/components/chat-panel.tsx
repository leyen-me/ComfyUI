import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'

import { Button } from './ui/button'

/**
 * 右侧对话区：输入框居中。消息通道尚未接入。
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
    <aside className="flex min-w-0 flex-1 flex-col border-l border-border">
      <div className="flex flex-1 items-center justify-center px-6">
        <form onSubmit={submit} className="w-full max-w-2xl">
          <div className="rounded-2xl border border-border bg-card p-2.5 shadow-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              value={value}
              rows={3}
              placeholder="输入消息"
              aria-label="消息输入"
              className="w-full resize-none bg-transparent px-2 py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
              onKeyDown={onKeyDown}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="flex justify-end px-1 pt-1">
              <Button
                type="submit"
                size="icon"
                variant="primary"
                className="size-8 rounded-xl"
                aria-label="发送"
                disabled={!value.trim()}
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </aside>
  )
}
