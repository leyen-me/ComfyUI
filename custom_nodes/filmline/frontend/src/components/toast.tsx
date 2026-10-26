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
        'pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-elevated py-2 pr-4 pl-3 text-[13px] text-foreground shadow-[var(--shadow-pop)] transition-all duration-200',
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
