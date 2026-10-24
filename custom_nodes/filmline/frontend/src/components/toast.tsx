import { cn } from '@/lib/utils'

export interface ToastMessage {
  id: number
  text: string
  tone: 'ok' | 'error'
}

export function Toast({ message }: { message: ToastMessage | null }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed right-6 bottom-6 z-50 rounded-lg border px-4 py-2.5 text-sm shadow-xl transition-all duration-200',
        message ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        message?.tone === 'error'
          ? 'border-destructive/40 bg-destructive/15 text-destructive'
          : 'border-border bg-card text-foreground',
      )}
    >
      {message?.text ?? ''}
    </div>
  )
}
