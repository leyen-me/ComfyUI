/**
 * 渲染冒烟测试：在 jsdom 里真实执行构建产物，确认首屏能渲染出内容。
 *
 * 目的不是替代浏览器测试，而是拦住“整页白屏”这类最贵的错误——
 * TypeScript 和打包器都发现不了运行时崩溃。
 *
 *   npm run smoke
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const webDir = new URL('../../web/', import.meta.url)
const html = readFileSync(new URL('index.html', webDir), 'utf8')

const entry = html.match(/src="([^"]+\.js)"/)?.[1]
if (!entry) throw new Error('构建产物里找不到入口脚本，先执行 npm run build')

const bundle = new URL(entry.replace(/^\/studio\/static\//, ''), webDir)

const dom = new JSDOM(html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, ''), {
  url: 'http://127.0.0.1:8188/studio',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})

const { window } = dom
for (const key of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLDialogElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLSelectElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'Element',
  'Node',
  'Text',
  'Comment',
  'DocumentFragment',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'KeyboardEvent',
  'MutationObserver',
  'DOMParser',
  'DOMRect',
  'File',
  'Blob',
  'FormData',
  'getComputedStyle',
  'localStorage',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'CSS',
]) {
  // Node 22 的 navigator 等是只读 getter，需要 defineProperty 覆盖
  Object.defineProperty(globalThis, key, {
    value: window[key],
    configurable: true,
    writable: true,
  })
}
globalThis.document = window.document

const projects = [
  {
    id: 1,
    code: 'PRJ-0001',
    name: '冒烟测试项目',
    description: '由渲染测试注入',
    created_at: '2026-10-24T07:00:00.000Z',
    updated_at: '2026-10-24T07:00:00.000Z',
  },
]

globalThis.fetch = async (input) => {
  const url = String(input)
  const data = url.includes('/health')
    ? { version: '0.1.0', db: ':memory:', schema_version: 1, projects: projects.length }
    : { items: projects, total: projects.length, limit: 20, offset: 0 }
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data }),
  }
}

const errors = []
const originalError = console.error
console.error = (...args) => {
  errors.push(args.map(String).join(' '))
  originalError(...args)
}

await import(pathToFileURL(fileURLToPath(bundle)).href)
await new Promise((resolve) => setTimeout(resolve, 400))

const root = document.getElementById('root')
const text = root?.textContent ?? ''

const checks = [
  ['渲染出侧边栏品牌', text.includes('Filmline')],
  ['渲染出项目标题', text.includes('项目')],
  ['渲染出项目数据', text.includes('冒烟测试项目')],
  ['渲染出项目编号', text.includes('PRJ-0001')],
  ['默认深色主题', document.documentElement.classList.contains('dark')],
  ['无控制台错误', errors.length === 0],
]

let failed = false
for (const [label, passed] of checks) {
  console.log(`${passed ? '✓' : '✗'} ${label}`)
  if (!passed) failed = true
}

if (failed) {
  if (errors.length > 0) originalError('控制台错误:\n' + errors.join('\n'))
  process.exit(1)
}

console.log('\n首屏渲染正常')
