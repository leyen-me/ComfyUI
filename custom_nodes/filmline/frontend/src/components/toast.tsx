import { CircleAlert, CircleCheck } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface ToastMessage {
  id: number
  text: string
  tone: 'ok' | 'error'
}

export function Toast({ message }: { message: ToastMessage | null }) {
  const Icon = message?.tone === 'error' ? CircleAlert : CircleCheck
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-elevated py-2 pr-4 pl-3 text-center text-[13px] text-foreground shadow-[var(--shadow-pop)] transition-all duration-200 lg:bottom-6',
        message ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
      )}
    >
      {message ? (
        <Icon
          className={cn(
            'size-4 shrink-0',
            message.tone === 'error' ? 'text-destructive' : 'text-emerald-500',
          )}
        />
      ) : null}
      {message?.text ?? ''}
    </div>
  )
}
