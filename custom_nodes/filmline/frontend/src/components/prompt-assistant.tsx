import { useState } from 'react'
import { AlertTriangle, CheckCircle2, LayoutTemplate, Loader2, Sparkles } from 'lucide-react'

import {
  fullTemplate,
  lintPrompt,
  modeHint,
  sectionsFor,
  snippetsFor,
  type AssistantCounts,
  type AssistantKeyframes,
  type AssistantMode,
  type AssistantVideoMode,
} from '@/lib/prompt-assistant'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'

interface PromptAssistantProps {
  mode: AssistantMode
  videoMode: AssistantVideoMode
  keyframes: AssistantKeyframes
  counts: AssistantCounts
  prompt: string
  disabled?: boolean
  canOptimize: boolean
  optimizing: boolean
  optimizeError: string | null
  onOptimize: () => void
  onInsert: (text: string) => void
  onInsertTemplate: (text: string) => void
}

type Tab = 'build' | 'check'

/**
 * 提示词助手：作为输入框上方的浮层出现，不挤占输入区布局。
 *
 * 信息按使用频率分层：最上面是两个「一步到位」的动作（AI 优化 / 整段模板），
 * 其次是按段落搭建（结构 + 标签），格式检查单独一页，有问题时在页签上提示数量。
 */
export function PromptAssistant({
  mode,
  videoMode,
  keyframes,
  counts,
  prompt,
  disabled = false,
  canOptimize,
  optimizing,
  optimizeError,
  onOptimize,
  onInsert,
  onInsertTemplate,
}: PromptAssistantProps) {
  const sections = sectionsFor(mode, videoMode, keyframes, counts)
  const snippets = snippetsFor(mode, videoMode, counts)
  const warnings = lintPrompt({ mode, videoMode, prompt, counts })
  const hint = modeHint(mode, videoMode, keyframes)
  const [tab, setTab] = useState<Tab>('build')

  return (
    <section aria-label="提示词助手" className="flex max-h-[min(560px,70vh)] flex-col">
      <header className="px-2.5 pt-2 pb-3">
        <h3 className="text-[13px] font-semibold tracking-tight">提示词助手</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </header>

      <div className="grid grid-cols-2 gap-2 px-2.5 pb-3">
        <QuickAction
          icon={optimizing ? Loader2 : Sparkles}
          spinning={optimizing}
          title={optimizing ? '优化中…' : 'AI 优化'}
          caption={canOptimize ? '按当前素材重写整段' : '仅支持视频提示词'}
          disabled={!canOptimize || disabled || optimizing || !prompt.trim()}
          accent
          onClick={onOptimize}
        />
        <QuickAction
          icon={LayoutTemplate}
          title="完整模板"
          caption="插入全部段落骨架"
          disabled={disabled}
          onClick={() => onInsertTemplate(fullTemplate(mode, videoMode, keyframes, counts))}
        />
      </div>

      {optimizeError ? (
        <p className="mx-2.5 mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-xs leading-relaxed text-destructive">
          {optimizeError}
        </p>
      ) : null}

      <div role="tablist" className="mx-2.5 flex gap-4 border-b border-border">
        <TabButton active={tab === 'build'} onClick={() => setTab('build')}>
          按段落搭建
        </TabButton>
        <TabButton active={tab === 'check'} onClick={() => setTab('check')}>
          格式检查
          {warnings.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 font-mono text-[10px] text-amber-600 dark:text-amber-400">
              {warnings.length}
            </span>
          ) : null}
        </TabButton>
      </div>

      <div data-scroll-region className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-3 pb-2.5">
        {tab === 'build' ? (
          <>
            <div className="grid grid-cols-2 gap-1.5">
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  disabled={disabled}
                  title={section.hint}
                  className="group cursor-pointer rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:border-foreground/20 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onInsertTemplate(section.template)}
                >
                  <span className="block truncate text-xs font-medium">{section.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                    {section.hint}
                  </span>
                </button>
              ))}
            </div>

            {snippets.length > 0 ? (
              <>
                <div className="pt-4 pb-2 text-[11px] font-medium text-muted-foreground">
                  标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {snippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      disabled={disabled}
                      className="cursor-pointer rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() =>
                        snippet.block ? onInsertTemplate(snippet.text) : onInsert(snippet.text)
                      }
                    >
                      {snippet.label}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : warnings.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="size-5 text-emerald-500" />
            <p className="mt-2 text-xs text-muted-foreground">没有发现格式问题</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {warnings.map((warning) => (
              <li
                key={warning.id}
                className={cn(
                  'flex gap-2 rounded-lg px-2.5 py-2 text-xs leading-relaxed',
                  warning.level === 'error'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                )}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canOptimize ? (
        <p className="border-t border-border px-2.5 pt-2 pb-1 text-[11px] text-muted-foreground/80">
          AI 优化会把首尾帧与参考图发送给 DeepSeek，不上传视频和音频。
        </p>
      ) : null}
    </section>
  )
}

function QuickAction({
  icon: Icon,
  title,
  caption,
  disabled,
  accent = false,
  spinning = false,
  onClick,
}: {
  icon: typeof Sparkles
  title: string
  caption: string
  disabled: boolean
  accent?: boolean
  spinning?: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant="secondary"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-auto flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left whitespace-normal',
        accent && 'border-primary/30 bg-primary/8 hover:border-primary/50 hover:bg-primary/12',
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px]">
        <Icon className={cn('size-3.5', accent && 'text-primary', spinning && 'animate-spin')} />
        {title}
      </span>
      <span className="text-[11px] font-normal text-muted-foreground">{caption}</span>
    </Button>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        '-mb-px flex cursor-pointer items-center border-b-2 pb-2 text-xs transition-colors focus-visible:outline-none',
        active
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
