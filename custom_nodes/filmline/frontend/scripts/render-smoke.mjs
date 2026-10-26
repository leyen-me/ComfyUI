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

const runningTask = {
  id: 100,
  client_id: 'client-running',
  prompt_id: 'prompt-running',
  project_id: 1,
  project_code: 'PRJ-0001',
  project_name: '冒烟测试项目',
  episode_id: null,
  episode_code: null,
  kind: 'video',
  status: 'running',
  prompt_excerpt: '雪夜长安街，红灯笼',
  client_label: '冒烟测试员',
  created_at: '2026-10-24T07:00:00.000Z',
  started_at: '2026-10-24T07:00:02.000Z',
  finished_at: null,
  elapsed_ms: null,
  error: null,
  asset_ids: [],
  queue_position: 0,
  external: false,
}

const doneTask = {
  ...runningTask,
  id: 101,
  client_id: 'client-done',
  prompt_id: 'prompt-done',
  status: 'succeeded',
  finished_at: '2026-10-24T07:00:53.000Z',
  elapsed_ms: 51200,
  asset_ids: [11],
  queue_position: null,
}

let queueTask = { ...runningTask }

globalThis.fetch = async (input, init = {}) => {
  const path = new URL(String(input), 'http://127.0.0.1:8188').pathname
  const method = (init.method ?? 'GET').toUpperCase()
  let data

  if (path.endsWith('/health')) {
    data = { version: '0.1.0', db: ':memory:', schema_version: 4, projects: 1 }
  } else if (path.endsWith('/tasks')) {
    data = {
      items: [{ ...queueTask }, { ...doneTask }],
      active: queueTask.status === 'running' ? 1 : 0,
    }
  } else if (path.endsWith('/prompts/optimize') && method === 'POST') {
    data = {
      enhanced_prompt:
        'integrated_multimodal_description: AI优化结果 <d>[Chinese] 测试对白</d> No subtitles, no captions, no on-screen text.',
      warnings: [],
      notes: 'mock optimizer',
      model: 'deepseek-chat',
    }
  } else if (/\/tasks\/\d+\/cancel$/.test(path) && method === 'POST') {
    queueTask = {
      ...queueTask,
      status: 'cancelled',
      finished_at: '2026-10-24T07:00:10.000Z',
      queue_position: null,
    }
    data = { ...queueTask }
  } else if (/\/tasks\/\d+$/.test(path)) {
    data = { ...queueTask }
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
  hasCount: Boolean(document.querySelector('[role="combobox"][aria-label="生成数量"]')),
}

// 提示词助手：默认收起，展开后以浮层出现段落搭建与标签
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '助手')
  ?.click()
await wait(200)
const assistantText =
  document.querySelector('section[aria-label="提示词助手"]')?.textContent ?? ''
const assistantShown =
  assistantText.includes('按段落搭建') && assistantText.includes('标签')
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.includes('完整模板'))
  ?.click()
await wait(200)
const assistantTemplateInserted = (
  document.querySelector('[aria-label="提示词"]')?.textContent ?? ''
).includes('主体：')
;[...document.querySelectorAll('button[aria-expanded="true"]')]
  .find((el) => el.textContent?.trim() === '助手')
  ?.click()
await wait(150)

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
const durationTrigger = () =>
  document.querySelector('[role="combobox"][aria-label="视频时长"]')
const videoMode = {
  hasDuration: Boolean(durationTrigger()),
  noCount: !document.querySelector('[role="combobox"][aria-label="生成数量"]'),
  hasTier: videoTrigger.includes('·') && videoTrigger.includes('768p'),
}

// 时长：默认 5 秒 → 选预设 8 秒 → 自定义 13 秒
const durationDefault = (durationTrigger()?.textContent ?? '').includes('5 秒')
durationTrigger()?.click()
await wait(200)
;[...document.querySelectorAll('[role="option"]')]
  .find((el) => el.textContent?.includes('8 秒'))
  ?.click()
await wait(150)
const durationPreset = (durationTrigger()?.textContent ?? '').includes('8 秒')
durationTrigger()?.click()
await wait(200)
const durationHintShown = (document.querySelector('[role="listbox"]')?.parentElement?.textContent ?? '')
  .includes('帧 · 实际')
const durationCustomInput = document.querySelector('input[aria-label="自定义视频时长（秒）"]')
if (durationCustomInput) {
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setValue?.call(durationCustomInput, '13')
  durationCustomInput.dispatchEvent(new window.Event('input', { bubbles: true }))
}
await wait(100)
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '应用')
  ?.click()
await wait(200)
const durationCustom = (durationTrigger()?.textContent ?? '').includes('13 秒')

// 首尾帧：两个独立槽位 + 视频方式切换；点击槽位可从资产库选图
const keyframeSlots = document.querySelectorAll('[data-keyframe-slot]')
const hasVideoModeTabs = Boolean(document.querySelector('[aria-label="视频生成方式"]'))
document.querySelector('[data-keyframe-slot="first"] button')?.click()
await wait(300)
const pickerDialog = document.querySelector('dialog[open]')
const pickerOpened = (pickerDialog?.textContent ?? '').includes('选择首帧')
;[...(pickerDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.includes('project_00001_.png'))
  ?.click()
await wait(300)
const firstFramePicked = Boolean(
  document.querySelector('[data-keyframe-slot="first"] img'),
)

// 视频拖到尾帧槽位：应打开选帧对话框，而不是把视频当图片塞进去
const videoDragData = {
  types: ['application/x-filmline-asset'],
  getData: (type) =>
    type === 'application/x-filmline-asset'
      ? JSON.stringify({
          assetId: 11,
          src: '/studio/api/assets/11/content',
          name: 'project_video_00001_.mp4',
          kind: 'video',
        })
      : '',
  dropEffect: 'copy',
  effectAllowed: 'copy',
}
const videoDrop = new window.Event('drop', { bubbles: true, cancelable: true })
Object.defineProperty(videoDrop, 'dataTransfer', { value: videoDragData })
document.querySelector('[data-keyframe-slot="last"]')?.dispatchEvent(videoDrop)
await wait(250)
const videoFrameDialog = document.querySelector('dialog[open]')
const videoFrameDialogOpened = (videoFrameDialog?.textContent ?? '').includes(
  '从视频选择尾帧',
)
;[...(videoFrameDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.trim() === '取消')
  ?.click()
await wait(150)

// AI 优化：视频模式展开助手、插入模板、优化、预览并应用
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '助手')
  ?.click()
await wait(200)
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.includes('完整模板'))
  ?.click()
await wait(200)
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.includes('AI 优化') && el.closest('section[aria-label="提示词助手"]'))
  ?.click()
await wait(300)
const optimizeDialog = document.querySelector('dialog[open]')
const optimizePreviewShown = (optimizeDialog?.textContent ?? '').includes('优化后（可编辑）')
;[...document.querySelectorAll('dialog[open] button')]
  .find((el) => el.textContent?.trim() === '应用并替换')
  ?.click()
await wait(250)
const optimizeApplied = (
  document.querySelector('[aria-label="提示词"]')?.textContent ?? ''
).includes('AI优化结果')
;[...document.querySelectorAll('button[aria-expanded="true"]')]
  .find((el) => el.textContent?.trim() === '助手')
  ?.click()
await wait(150)

// 参考生成：托盘 + 多选选择器 + 模式切换保留状态
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '参考生成')
  ?.click()
await wait()
const referenceTrayShown = Boolean(document.querySelector('[data-reference-tray]'))
document.querySelector('button[aria-label="添加参考图片"]')?.click()
await wait(300)
const referenceDialog = document.querySelector('dialog[open]')
const referencePickerOpened = (referenceDialog?.textContent ?? '').includes('添加参考图片')
;[...(referenceDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.includes('project_00001_.png'))
  ?.click()
await wait(100)
;[...(referenceDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.includes('添加 1 张'))
  ?.click()
await wait(300)
const referenceCard = document.querySelector('[data-reference-item="image-0"]')
const referenceAdded = Boolean(referenceCard) && (referenceCard?.textContent ?? '').includes('图1')
document.querySelector('button[aria-label="插入 Picture 1 引用"]')?.click()
await wait(200)
const referenceTagInserted = (
  document.querySelector('[aria-label="提示词"]')?.textContent ?? ''
).includes('<Picture 1>')

// 参考视频选择器：不能只显示文字，缩略视频要能看到首帧
document.querySelector('button[aria-label="添加参考视频"]')?.click()
await wait(300)
const videoPickerDialog = document.querySelector('dialog[open]')
const videoPickerThumbShown = Boolean(videoPickerDialog?.querySelector('video'))
;[...(videoPickerDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.trim() === '取消')
  ?.click()
await wait(150)

function dropReference(payload) {
  const dataTransfer = {
    types: ['application/x-filmline-asset'],
    getData: (type) =>
      type === 'application/x-filmline-asset' ? JSON.stringify(payload) : '',
    dropEffect: 'copy',
    effectAllowed: 'copy',
  }
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  document.querySelector('[data-reference-drop]')?.dispatchEvent(event)
}

dropReference({
  assetId: 11,
  src: '/studio/api/assets/11/content',
  name: 'project_video_00001_.mp4',
  kind: 'video',
  duration: 2.5,
  hasAudio: true,
})
await wait(250)
dropReference({
  assetId: 12,
  src: '/studio/api/assets/12/content',
  name: 'voice.wav',
  kind: 'audio',
  duration: 2,
  hasAudio: true,
})
await wait(250)
const videoRefCard = document.querySelector('[data-reference-item="video-0"]')
const audioRefCard = document.querySelector('[data-reference-item="audio-0"]')
const videoRefAdded = Boolean(videoRefCard)
const audioRefAdded = Boolean(audioRefCard)
const soundtrackDefault = Boolean(videoRefCard?.querySelector('input[type="checkbox"]')?.checked)
document.querySelector('button[aria-label="插入 Video 1 引用"]')?.click()
await wait(100)
document.querySelector('button[aria-label="插入 Audio 2 引用"]')?.click()
await wait(100)
const mediaTagsInserted = (
  document.querySelector('[aria-label="提示词"]')?.textContent ?? ''
).includes('<Video 1>') &&
  (document.querySelector('[aria-label="提示词"]')?.textContent ?? '').includes('<Audio 2>')

// 参考视频裁剪：应打开独立 dialog，而不是卡片内气泡
document.querySelector('button[aria-label="裁剪参考视频1"]')?.click()
await wait(200)
const trimDialog =
  [...document.querySelectorAll('dialog[open]')].find((el) =>
    el.textContent?.includes('裁剪参考视频'),
  ) ?? null
const trimDialogOpened =
  (trimDialog?.textContent ?? '').includes('裁剪参考视频') &&
  Boolean(trimDialog?.querySelector('[aria-label="裁剪区间入点"]')) &&
  Boolean(trimDialog?.querySelector('[aria-label="裁剪区间出点"]')) &&
  (trimDialog?.querySelectorAll('input[type="range"]').length ?? 0) === 2
;[...(trimDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.trim() === '取消')
  ?.click()
await wait(150)

// 文本资产拖进提示词输入框：直接变成文字（视频模式下图片块被禁用，文本仍应可插入）
function dropTextAsset(text) {
  const dataTransfer = {
    types: ['application/x-filmline-asset'],
    getData: (type) =>
      type === 'application/x-filmline-asset'
        ? JSON.stringify({
            assetId: 31,
            src: '',
            name: '第一章第一节',
            kind: 'text',
            text,
            source: 'user',
          })
        : '',
    dropEffect: 'copy',
    effectAllowed: 'copy',
  }
  const event = new window.Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  Object.defineProperty(event, 'clientX', { value: 12 })
  Object.defineProperty(event, 'clientY', { value: 12 })
  document.querySelector('[aria-label="提示词"]')?.dispatchEvent(event)
}

dropTextAsset('第一章正文：风起长安，灯影摇红。\n第二段：更鼓三声。')
await wait(250)
const droppedPromptText = document.querySelector('[aria-label="提示词"]')?.textContent ?? ''
const textAssetDropped =
  droppedPromptText.includes('风起长安') && droppedPromptText.includes('更鼓三声')

;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '首尾帧')
  ?.click()
await wait()
const keyframeSlotsAgain = document.querySelectorAll('[data-keyframe-slot]').length
;[...document.querySelectorAll('button')]
  .find((el) => el.textContent?.trim() === '参考生成')
  ?.click()
await wait()
const referencePersisted = Boolean(document.querySelector('[data-reference-item="image-0"]'))

// 视频面板里应当有 768 原生 / 0.4MP 草稿两档
document.querySelector('button[aria-label="尺寸与分辨率"]')?.click()
await wait(250)
const videoPanel = [...document.querySelectorAll('[role="dialog"]')].find((el) =>
  el.textContent?.includes('比例'),
)
const videoOptionsText = videoPanel?.textContent ?? ''
document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
await wait(150)
document.querySelector('[aria-label="生成类型"] button')?.click()
await wait()
const activeNavOnProject = [...document.querySelectorAll('aside a[aria-current="page"]')].map(
  (el) => el.textContent?.trim() ?? '',
)
const keyframeSlotsAfterImage = document.querySelectorAll('[data-keyframe-slot]').length
const referenceTrayAfterImage = Boolean(document.querySelector('[data-reference-tray]'))

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

// 文本资产：单击条目直接进入编辑（不必展开菜单）
byLabel('编辑 第一幕')?.click()
await wait(300)
const clickEditDialog = document.querySelector('dialog[open]')
const clickOpensEdit =
  clickEditDialog?.querySelector('#asset-name')?.value === '第一幕' &&
  clickEditDialog?.querySelector('#asset-content')?.value === '夜，外景，长安城。'
;[...(clickEditDialog?.querySelectorAll('button') ?? [])]
  .find((el) => el.textContent?.trim() === '取消')
  ?.click()
await wait(200)

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

document.querySelector('button[aria-label="查看 project_00001_.png"]')?.click()
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

// —— 视频卡片：列表只放静音缩略，点开才是带控制条的详情 ——
window.history.pushState({}, '', '/studio/projects/PRJ-0001/assets/video')
window.dispatchEvent(new window.PopStateEvent('popstate'))
await wait(400)
document.querySelector('button[aria-label="预览 project_video_00001_.mp4"]')?.click()
await wait(250)
const videoDialog = document.querySelector('dialog[open]')
const videoPreviewOpened = Boolean(videoDialog?.querySelector('video'))
const videoListNoControls =
  document.querySelectorAll('article video').length > 0 &&
  document.querySelectorAll('article video[controls]').length === 0
videoDialog?.querySelectorAll('button').forEach((el) => {
  if (el.textContent?.trim() === '关闭') el.click()
})
await wait(150)

// —— 全局任务队列：右上角入口，显示进行中与最近完成 ——
byLabel('任务队列')?.click()
await wait(250)
const queueText = document.querySelector('[role="dialog"]')?.textContent ?? ''
const taskQueueVisible =
  queueText.includes('任务队列') &&
  queueText.includes('运行中') &&
  queueText.includes('已完成') &&
  queueText.includes('冒烟测试项目')
// 面板内部滚动不能关闭面板（scroll 事件不冒泡，但捕获阶段会经过 window）
document
  .querySelector('[role="dialog"] [data-scroll-region]')
  ?.dispatchEvent(new window.Event('scroll'))
await wait(150)
const queueSurvivesInnerScroll = Boolean(
  document.querySelector('[role="dialog"] [data-scroll-region]'),
)
document.querySelector('button[aria-label="取消任务 100"]')?.click()
await wait(250)
const cancelUpdated = (
  document.querySelector('[role="dialog"]')?.textContent ?? ''
).includes('已取消')
document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }))
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
  ['提示词助手可展开', assistantShown],
  ['提示词助手可插入模板', assistantTemplateInserted],
  ['默认图片模式', panel.imageDefault],
  ['尺寸选择是一个组合按钮', panel.hasOptions && panel.hasCount],
  ['面板含比例与分辨率两组', optionsText.includes('比例') && optionsText.includes('分辨率')],
  ['只提供 1K/2K（无 4K）', optionsText.includes('1K') && optionsText.includes('2K') && !has4k],
  ['选择 2K 后按钮同步显示', triggerAfterTier.includes('2K')],
  ['视频有尺寸与时长', videoMode.hasDuration && videoMode.noCount],
  ['时长默认 5 秒', durationDefault],
  ['时长可选预设 8 秒', durationPreset],
  ['时长面板显示帧数与实际时长', durationHintShown],
  ['时长可自定义 13 秒', durationCustom],
  ['视频有分辨率档位', videoMode.hasTier && videoOptionsText.includes('分辨率')],
  ['视频有首尾帧两个槽位', keyframeSlots.length === 2 && hasVideoModeTabs],
  ['首帧槽位可打开资产选择器', pickerOpened],
  ['选择图片后首帧槽位显示缩略图', firstFramePicked],
  ['视频拖到槽位打开选帧对话框', videoFrameDialogOpened],
  ['AI 优化可预览并应用', optimizePreviewShown && optimizeApplied],
  ['参考模式显示参考素材托盘', referenceTrayShown],
  ['参考图选择器可多选', referencePickerOpened],
  ['选择参考图后显示图1', referenceAdded],
  ['参考图可插入 Picture 引用', referenceTagInserted],
  ['参考视频选择器显示视频缩略图', videoPickerThumbShown],
  ['参考视频可拖入托盘', videoRefAdded],
  ['参考音频可拖入托盘', audioRefAdded],
  ['视频原声默认占用音轨', soundtrackDefault],
  ['视频/音频引用可插入提示词', mediaTagsInserted],
  ['参考视频裁剪打开独立对话框', trimDialogOpened],
  ['文本资产拖入输入框变成文字', textAssetDropped],
  ['切回首尾帧再切回参考模式保留素材', keyframeSlotsAgain === 2 && referencePersisted],
  ['切回图片模式隐藏首尾帧槽位', keyframeSlotsAfterImage === 0],
  ['切回图片模式隐藏参考托盘', !referenceTrayAfterImage],
  ['项目资产页仅「资产」高亮', activeNavOnProject.length === 1 && activeNavOnProject[0] === '项目资产'],
  ['分集页仅当前集高亮', activeNavOnEpisode.length === 1 && activeNavOnEpisode[0].includes('EP01')],
  ['分集创建后出现在导航', afterEpisodeCreate.includes('EP01')],
  ['分集页显示集标题', episodeText.includes('EP01 · 本集素材') && episodeText.includes('第 1 集')],
  ['项目内不出现删除项目', projectMenuItems.includes('编辑') && !projectMenuItems.includes('删除')],
  ['资产菜单挂在 body 上（不被裁剪）', menuInBody && !menuInRoot],
  ['编辑弹窗回填文本内容', prefilled],
  ['文本资产单击进入编辑', clickOpensEdit],
  ['资产改名立即更新', afterAssetEdit.includes('第一幕（改）')],
  ['列表不展示提示词', !imageTabText.includes('雪夜长安街，红灯笼')],
  ['点击图片打开预览', previewText.includes('让他图1笑起来') && previewText.includes('1344×768')],
  ['预览显示生成耗时', previewText.includes('耗时 1 分 41 秒') && previewText.includes('开始')],
  ['复用提示词回填面板', reused],
  ['复用后「图1」还原为图片块', chipRestored],
  ['复制失败时兜底弹窗可手动复制', fallbackShown],
  ['视频卡片下半部分可打开预览', videoPreviewOpened],
  ['视频列表为无控制条的缩略预览', videoListNoControls],
  ['右上角任务队列显示进行中/完成', taskQueueVisible],
  ['任务队列可取消进行中任务', cancelUpdated],
  ['任务队列内部滚动不关闭面板', queueSurvivesInnerScroll],
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
process.exit(0)
