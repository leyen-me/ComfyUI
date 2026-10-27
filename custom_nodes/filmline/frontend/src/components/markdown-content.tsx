import { useRef, useState } from 'react'
import { Check, Copy, ExternalLink, ImageOff } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/utils'

/** 只允许安全协议；原始 HTML 一律不渲染。 */
function safeUrl(url: string): string {
  return /^(https?:|mailto:|\/|#)/i.test(url) ? url : ''
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-muted/35">
      <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-1">
        <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          code
        </span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(ref.current?.innerText ?? '')) {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            }
          }}
          className="ml-auto flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre
        ref={ref}
        className="overflow-x-auto p-2.5 font-mono text-[11.5px] leading-relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[inherit]"
      >
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-[17px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-[15.5px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-[14.5px] font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 leading-7 first:mt-0 last:mb-0">{children}</p>,
  a: ({ href, children }) => {
    const url = safeUrl(href ?? '')
    if (!url) return <span>{children}</span>
    const external = /^https?:/i.test(url)
    return (
      <a
        href={url}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        className="text-primary underline decoration-primary/35 underline-offset-2 hover:decoration-primary"
      >
        {children}
        {external ? <ExternalLink className="ml-0.5 inline size-2.5 align-top" /> : null}
      </a>
    )
  },
  ul: ({ children }) => (
    <ul className="my-1.5 list-disc space-y-0.5 pl-5 marker:text-muted-foreground">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1.5 list-decimal space-y-0.5 pl-5 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border" />,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="text-foreground/90">{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  code: ({ children, className }) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    return (
      <code
        className={cn(
          'font-mono',
          isBlock
            ? 'block text-[11.5px]'
            : 'rounded bg-muted px-1 py-0.5 text-[0.9em] text-foreground/90',
        )}
      >
        {children}
      </code>
    )
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1.5 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border-b border-border/60 px-2 py-1.5 align-top">{children}</td>,
  tr: ({ children }) => <tr className="last:[&>td]:border-b-0">{children}</tr>,
  img: ({ src, alt }) => {
    const url = typeof src === 'string' ? safeUrl(src) : ''
    if (!url) {
      return <span className="text-[12px] text-muted-foreground">[图片]</span>
    }
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="my-1 inline-flex items-center gap-1 rounded border border-border bg-muted/40 px-2 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
        title="为避免自动请求外部资源，图片不直接加载"
      >
        <ImageOff className="size-3" />
        {alt || '外链图片'}
      </a>
    )
  },
  input: (props) => (
    <input
      type="checkbox"
      checked={Boolean(props.checked)}
      disabled
      readOnly
      className="mr-1 size-3 align-middle accent-[var(--primary)]"
    />
  ),
}

/**
 * Markdown 渲染是展示层，不改变模型上下文。
 * 由 AgentTurn 动态 import，首屏不会加载这个 chunk。
 */
export default function MarkdownContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0 break-words', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
        skipHtml
        urlTransform={safeUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
