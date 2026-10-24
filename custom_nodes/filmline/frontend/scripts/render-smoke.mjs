/**
 * 渲染冒烟测试：在 jsdom 里真实执行构建产物，走一遍“列表 → 改名 → 项目页”。
 *
 * 目的不是替代浏览器测试，而是拦住“整页白屏”和“数据不刷新”这类
 * TypeScript 与打包器都发现不了的运行时问题。
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

// jsdom 尚未实现 <dialog>，这里补上组件需要的最小行为
Object.defineProperty(window.HTMLDialogElement.prototype, 'open', {
  configurable: true,
  get() {
    return this.hasAttribute('open')
  },
  set(value) {
    if (value) this.setAttribute('open', '')
    else this.removeAttribute('open')
  },
})
// ProseMirror 会测量选区；jsdom 没有这些实现，补最小桩避免报错
const zeroRect = () => ({
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON() { return this },
})
window.Range.prototype.getClientRects = function getClientRects() {
  return { length: 0, item: () => null, [Symbol.iterator]: function* iterator() {} }
}
window.Range.prototype.getBoundingClientRect = zeroRect
window.Element.prototype.getClientRects = window.Element.prototype.getClientRects ?? function getClientRects() {
  return { length: 0, item: () => null, [Symbol.iterator]: function* iterator() {} }
}
window.document.elementFromPoint = () => window.document.body

window.HTMLDialogElement.prototype.showModal = function showModal() {
  this.open = true
}
window.HTMLDialogElement.prototype.close = function close() {
  this.open = false
  this.dispatchEvent(new window.Event('close'))
}

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

const project = {
  id: 1,
  code: 'PRJ-0001',
  name: '冒烟测试项目',
  description: '由渲染测试注入',
  created_at: '2026-10-24T07:00:00.000Z',
  updated_at: '2026-10-24T07:00:00.000Z',
}

const episodes = []

const aiImage = {
  id: 10,
  project_id: 1,
  episode_id: null,
  kind: 'image',
  source: 'ai',
  name: 'project_00001_.png',
  text_content: null,
  mime_type: 'image/png',
  size_bytes: 123456,
  content_url: '/studio/api/assets/10/content',
  meta: {
    prompt: '让他图1笑起来',
    size: '16:9',
    width: 1344,
    height: 768,
    seed: 42,
    steps: 20,
    ref_ids: [7],
  },
  created_at: '2026-10-24T07:00:00.000Z',
  updated_at: '2026-10-24T07:00:00.000Z',
  gen_started_at: '2026-10-24T07:00:00.000Z',
  gen_elapsed_ms: 101400,
}

const videoAsset = {
  id: 11,
  project_id: 1,
  episode_id: null,
  kind: 'video',
  source: 'ai',
  name: 'project_video_00001_.mp4',
  text_content: null,
  mime_type: 'video/mp4',
  size_bytes: 2_000_000,
  content_url: '/studio/api/assets/11/content',
  meta: { prompt: '雪夜长安街，红灯笼', size: '16:9', width: 1344, height: 768, seed: 7 },
  gen_started_at: '2026-10-24T07:00:00.000Z',
  gen_elapsed_ms: 51200,
  created_at: '2026-10-24T07:00:00.000Z',
  updated_at: '2026-10-24T07:00:00.000Z',
}

const asset = {
  id: 9,
  project_id: 1,
  kind: 'text',
  source: 'user',
  name: '第一幕',
  text_content: '夜，外景，长安城。',
  mime_type: null,
  size_bytes: null,
  content_url: null,
  meta: null,
  created_at: '2026-10-24T07:00:00.000Z',
  updated_at: '2026-10-24T07:00:00.000Z',
}

globalThis.fetch = async (input, init = {}) => {
  const path = new URL(String(input), 'http://127.0.0.1:8188').pathname
  const method = (init.method ?? 'GET').toUpperCase()
  let data

  if (path.endsWith('/health')) {
    data = { version: '0.1.0', db: ':memory:', schema_version: 4, projects: 1 }
  } else if (path.endsWith('/assets/counts')) {
    data = { text: 1, image: 0, video: 0, audio: 0 }
  } else if (path.endsWith('/episodes')) {
    if (method === 'POST') {
      const episode = {
        id: 100 + episodes.length,
        project_id: 1,
        number: episodes.length + 1,
        code: `EP0${episodes.length + 1}`,
        title: `第 ${episodes.length + 1} 集`,
        synopsis: '',
        created_at: '2026-10-24T07:00:00.000Z',
        updated_at: '2026-10-24T07:00:00.000Z',
      }
      episodes.push(episode)
      data = episode
    } else {
      data = { items: episodes, total: episodes.length }
    }
  } else if (/^\/studio\/api\/assets\/\d+$/.test(path)) {
    if (method === 'PATCH') {
      Object.assign(asset, JSON.parse(init.body))
      data = { ...asset }
    } else {
      data = { ...aiImage, id: 7, meta: null, content_url: '/studio/api/assets/7/content' }
    }
  } else if (path.endsWith('/assets')) {
    const kind = new URL(String(input), 'http://127.0.0.1:8188').searchParams.get('kind')
    data =
      kind === 'image'
        ? { items: [{ ...aiImage }], total: 1 }
        : kind === 'video'
          ? { items: [{ ...videoAsset }], total: 1 }
          : { items: [{ ...asset }], total: 1 }
  } else if (/^\/studio\/api\/assets\/\d+$/.test(path)) {
    if (method === 'PATCH') Object.assign(asset, JSON.parse(init.body))
    data = { ...asset }
  } else if (/^\/studio\/api\/projects\/[^/]+$/.test(path)) {
    if (method === 'PATCH') Object.assign(project, JSON.parse(init.body))
    data = project
  } else {
    data = { items: [{ ...project }], total: 1, limit: 20, offset: 0 }
  }

  return { ok: true, status: 200, json: async () => ({ ok: true, data }) }
}

const errors = []
const originalError = console.error
console.error = (...args) => {
  errors.push(args.map(String).join(' '))
  originalError(...args)
}

const wait = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))
const rootText = () => document.getElementById('root')?.textContent ?? ''
const byLabel = (label) =>
  [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label)

await import(pathToFileURL(fileURLToPath(bundle)).href)
await wait(400)

const listText = rootText()

// —— 交互回归：改名后列表必须立即更新，不需要刷新浏览器 ——
const renamed = '冒烟测试项目（改）'
byLabel('冒烟测试项目 的操作')?.click()
await wait()
;[...document.querySelectorAll('[role="menuitem"]')]
  .find((el) => el.textContent?.trim() === '编辑')
  ?.click()
await wait()

const nameInput = document.querySelector('#project-name')
if (nameInput) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setValue?.call(nameInput, renamed)
  nameInput.dispatchEvent(new window.Event('input', { bubbles: true }))
  await wait()
  document
    .querySelector('#project-form')
    ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(500)
}
const afterEditText = rootText()

// —— 进入项目页：独立导航 + 资产列表 + chat 输入框 ——
window.history.pushState({}, '', '/studio/projects/PRJ-0001')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(500)
const detailText = rootText()

const optionsTrigger = document.querySelector('button[aria-label="尺寸与分辨率"]')
const panel = {
  hasPrompt: Boolean(document.querySelector('[aria-label="提示词"][contenteditable="true"]')),
  imageDefault: [...document.querySelectorAll('button[aria-pressed="true"]')].some((el) =>
    el.textContent?.includes('图片'),
  ),
  hasOptions: Boolean(optionsTrigger) && (optionsTrigger?.textContent ?? '').includes('·'),
  hasCount: Boolean(document.querySelector('select[aria-label="生成数量"]')),
}

// 打开尺寸面板：应同时有「比例」「分辨率」两组，且不含 4K
optionsTrigger?.click()
await wait(250)
const optionsPanel = [...document.querySelectorAll('[role="dialog"]')].find((el) =>
  el.textContent?.includes('比例'),
)
const optionsText = optionsPanel?.textContent ?? ''
const has4k = optionsText.includes('4K')
;[...(optionsPanel?.querySelectorAll('button[aria-pressed]') ?? [])]
  .find((el) => el.textContent?.includes('2K'))
  ?.click()
await wait(200)
const triggerAfterTier = document.querySelector('button[aria-label="尺寸与分辨率"]')?.textContent ?? ''
document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
await wait(150)

// 切到视频：应当出现时长、且不再有数量
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.includes('视频'))
  ?.click()
await wait()
const videoTrigger = document.querySelector('button[aria-label="尺寸与分辨率"]')?.textContent ?? ''
const videoMode = {
  hasDuration: Boolean(document.querySelector('select[aria-label="视频时长"]')),
  noCount: !document.querySelector('select[aria-label="生成数量"]'),
  hasTier: videoTrigger.includes('768'),
}

// 视频面板里应当有 512 预览 / 768 原生 两档
document.querySelector('button[aria-label="尺寸与分辨率"]')?.click()
await wait(250)
const videoPanel = [...document.querySelectorAll('[role="dialog"]')].find((el) =>
  el.textContent?.includes('比例'),
)
const videoOptionsText = videoPanel?.textContent ?? ''
document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
await wait(150)
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.includes('图片'))
  ?.click()
await wait()
const activeNavOnProject = [...document.querySelectorAll('aside a[aria-current="page"]')].map(
  (el) => el.textContent?.trim() ?? '',
)

// —— 分集：新建后侧边栏出现，进入分集资产页显示集标题 ——
document.querySelector('button[aria-label="新建分集"]')?.click()
await wait()
document
  .querySelector('#episode-form')
  ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
await wait(500)
const afterEpisodeCreate = rootText()

window.history.pushState({}, '', '/studio/projects/PRJ-0001/episodes/EP01/assets/text')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(400)
const episodeText = rootText()
const activeNavOnEpisode = [...document.querySelectorAll('aside a[aria-current="page"]')].map(
  (el) => el.textContent?.trim() ?? '',
)

// —— 资产编辑：菜单必须挂在 body 上（不被滚动容器裁剪），且能改文本 ——
window.history.pushState({}, '', '/studio/projects/PRJ-0001/assets/text')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(400)

byLabel('项目操作')?.click()
await wait()
const projectMenuItems = [...document.querySelectorAll('[role="menuitem"]')].map((el) =>
  el.textContent?.trim(),
)
document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
await wait()

byLabel('第一幕 的操作')?.click()
await wait()
const menuInBody = Boolean(document.body.querySelector('[role="menu"]'))
const menuInRoot = Boolean(document.getElementById('root')?.querySelector('[role="menu"]'))
;[...document.querySelectorAll('[role="menuitem"]')]
  .find((el) => el.textContent?.trim() === '编辑')
  ?.click()
await wait()

const assetName = document.querySelector('#asset-name')
const assetContent = document.querySelector('#asset-content')
const prefilled =
  assetName?.value === '第一幕' && assetContent?.value === '夜，外景，长安城。'

if (assetName) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setValue?.call(assetName, '第一幕（改）')
  assetName.dispatchEvent(new window.Event('input', { bubbles: true }))
  await wait()
  document
    .querySelector('#asset-form')
    ?.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
  await wait(500)
}
const afterAssetEdit = rootText()

// —— 图片资产：提示词可见、点图预览、复用回填 ——
window.history.pushState({}, '', '/studio/projects/PRJ-0001/assets/image')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(400)
const imageTabText = rootText()

document.querySelector('button[aria-label="放大 project_00001_.png"]')?.click()
await wait(200)
const previewDialog = document.querySelector('dialog[open]')
const previewText = previewDialog?.textContent ?? ''

// jsdom 没有剪贴板与 execCommand，应当弹出兜底弹窗并选中文本
;[...document.querySelectorAll('dialog[open] button')]
  .find((el) => el.textContent?.includes('复制提示词'))
  ?.click()
await wait(200)
const fallbackArea = document.querySelector('dialog[open] textarea')
const fallbackShown = fallbackArea?.value === '让他图1笑起来'
fallbackArea
  ?.closest('dialog')
  ?.querySelectorAll('button')
  .forEach((el) => {
    if (el.textContent?.trim() === '关闭') el.click()
  })
await wait(150)

;[...document.querySelectorAll('dialog[open] button')]
  .find((el) => el.textContent?.includes('用此提示词生成'))
  ?.click()
await wait(500)
const promptField = document.querySelector('[aria-label="提示词"]')
const reused = (promptField?.textContent ?? '').includes('图1')
const chipRestored =
  document.querySelectorAll('[data-image-chip]').length === 1 &&
  (promptField?.textContent ?? '').includes('让他')

// —— 视频卡片：下半部分点开预览（缩略图被播放器占用）——
window.history.pushState({}, '', '/studio/projects/PRJ-0001/assets/video')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(400)
document.querySelector('button[aria-label="预览 project_video_00001_.mp4"]')?.click()
await wait(250)
const videoDialog = document.querySelector('dialog[open]')
const videoPreviewOpened = Boolean(videoDialog?.querySelector('video'))
videoDialog?.querySelectorAll('button').forEach((el) => {
  if (el.textContent?.trim() === '关闭') el.click()
})
await wait(150)

const checks = [
  ['列表页渲染品牌', listText.includes('Filmline')],
  ['列表页渲染项目', listText.includes('冒烟测试项目')],
  ['列表页渲染编号', listText.includes('PRJ-0001')],
  ['默认深色主题', document.documentElement.classList.contains('dark')],
  ['改名后列表立即更新', afterEditText.includes(renamed)],
  ['项目页显示项目名', detailText.includes(renamed)],
  ['项目页有资产导航', ['文本', '图片', '视频', '音频'].every((label) => detailText.includes(label))],
  ['项目页有文本资产', detailText.includes('第一幕')],
  ['生成面板有提示词输入', panel.hasPrompt],
  ['默认图片模式', panel.imageDefault],
  ['尺寸选择是一个组合按钮', panel.hasOptions && panel.hasCount],
  ['面板含比例与分辨率两组', optionsText.includes('比例') && optionsText.includes('分辨率')],
  ['只提供 1K/2K（无 4K）', optionsText.includes('1K') && optionsText.includes('2K') && !has4k],
  ['选择 2K 后按钮同步显示', triggerAfterTier.includes('2K')],
  ['视频有尺寸与时长', videoMode.hasDuration && videoMode.noCount],
  ['视频默认 768 原生', videoMode.hasTier],
  ['视频提供 512 预览/768 原生', videoOptionsText.includes('512') && videoOptionsText.includes('768')],
  ['项目资产页仅「资产」高亮', activeNavOnProject.length === 1 && activeNavOnProject[0] === '资产'],
  ['分集页仅当前集高亮', activeNavOnEpisode.length === 1 && activeNavOnEpisode[0].includes('EP01')],
  ['分集创建后出现在导航', afterEpisodeCreate.includes('EP01')],
  ['分集页显示集标题', episodeText.includes('EP01 · 第 1 集')],
  ['项目内不出现删除项目', projectMenuItems.includes('编辑') && !projectMenuItems.includes('删除')],
  ['资产菜单挂在 body 上（不被裁剪）', menuInBody && !menuInRoot],
  ['编辑弹窗回填文本内容', prefilled],
  ['资产改名立即更新', afterAssetEdit.includes('第一幕（改）')],
  ['列表不展示提示词', !imageTabText.includes('雪夜长安街，红灯笼')],
  ['点击图片打开预览', previewText.includes('让他图1笑起来') && previewText.includes('1344×768')],
  ['预览显示生成耗时', previewText.includes('耗时 1 分 41 秒') && previewText.includes('开始')],
  ['复用提示词回填面板', reused],
  ['复用后「图1」还原为图片块', chipRestored],
  ['复制失败时兜底弹窗可手动复制', fallbackShown],
  ['视频卡片下半部分可打开预览', videoPreviewOpened],
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
