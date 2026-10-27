import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleAlert, Loader2, RefreshCw, Wallet } from 'lucide-react'

import { agentApi, type AgentBalanceInfo } from '@/lib/agent'
import { cn } from '@/lib/utils'
import { Popover } from './ui/popover'

const CURRENCY_SYMBOL: Record<string, string> = { CNY: '¥', USD: '$' }

function useCountUp(target: number | null, duration = 700): number {
  const [display, setDisplay] = useState(0)
  const previous = useRef(0)

  useEffect(() => {
    if (target === null || Number.isNaN(target)) return
    const from = previous.current
    previous.current = target
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(target)
      return
    }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (target - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return display
}

function money(currency: string, value: string | number): string {
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value}`
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `
  return `${symbol}${number.toFixed(2)}`
}

/**
 * 右上角余额：初始加载一次，每轮 run.finished 由父组件递增 refreshToken 触发刷新。
 * 数值变化用 requestAnimationFrame 做滚动动画；尊重 reduced-motion。
 */
export function AgentBalanceBadge({ refreshToken }: { refreshToken: number }) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<AgentBalanceInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      const result = await agentApi.balance(force)
      setData(result)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load, refreshToken])

  const primary = data?.items[0]
  const target = primary ? Number(primary.total) : null
  const display = useCountUp(Number.isFinite(target) ? target : null)

  const label = !data
    ? failed
      ? '余额 —'
      : '余额 …'
    : !data.configured
      ? '未配置'
      : primary
        ? money(primary.currency, display)
        : '余额 0.00'

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={
          failed
            ? '余额加载失败，点击查看'
            : data?.configured
              ? 'DeepSeek 余额 · 点击查看明细'
              : '未配置 DeepSeek API Key'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-card px-1.5 text-[11px] text-muted-foreground transition-colors hover:border-foreground/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none',
          data?.configured === false && 'opacity-60',
        )}
      >
        <Wallet className="size-3.5 shrink-0 text-primary" />
        {loading && !data ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <span className="font-mono tabular-nums">{label}</span>
        )}
        {data && !data.available ? (
          <CircleAlert className="size-3 shrink-0 text-amber-500" />
        ) : null}
      </button>

      <Popover open={open} onOpenChange={setOpen} anchorRef={anchorRef} width={260} align="end">
        <div className="p-2">
          <div className="flex items-center gap-1.5 px-1 pb-1.5">
            <Wallet className="size-3.5 text-primary" />
            <span className="text-[12px] font-medium">DeepSeek 余额</span>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              title="刷新余额"
              className="ml-auto cursor-pointer rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
            </button>
          </div>

          {failed ? (
            <p className="px-1 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              余额加载失败。可能是网络或 API Key 权限问题，不影响对话与生成。
            </p>
          ) : !data ? (
            <p className="px-1 py-2 text-[11.5px] text-muted-foreground">加载中…</p>
          ) : !data.configured ? (
            <p className="px-1 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              未配置 API Key，无法查询余额。
            </p>
          ) : data.items.length === 0 ? (
            <p className="px-1 py-2 text-[11.5px] text-muted-foreground">暂无余额信息。</p>
          ) : (
            <div className="space-y-2 px-1">
              {data.items.map((item) => (
                <div key={item.currency} className="rounded-lg border border-border bg-card/60 p-2">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-muted-foreground">{item.currency}</span>
                    <span className="font-mono text-[13px] tabular-nums text-foreground">
                      {money(item.currency, item.total)}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[10.5px] text-muted-foreground">
                    <span>赠金 {money(item.currency, item.granted)}</span>
                    <span className="text-right">充值 {money(item.currency, item.topped_up)}</span>
                  </div>
                </div>
              ))}
              {!data.available ? (
                <p className="flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
                  <CircleAlert className="size-3" />
                  余额不足，API 调用可能失败
                </p>
              ) : null}
              <p className="text-[10px] text-muted-foreground">
                {data.fetched_at
                  ? `更新于 ${new Date(data.fetched_at).toLocaleTimeString('zh-CN', {
                      hour12: false,
                    })} · 每轮对话结束自动刷新`
                  : '每轮对话结束自动刷新'}
              </p>
            </div>
          )}
        </div>
      </Popover>
    </>
  )
}
