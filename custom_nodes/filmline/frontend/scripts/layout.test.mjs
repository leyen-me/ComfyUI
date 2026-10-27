/**
 * 响应式布局逻辑的单元测试（纯函数，无 DOM 依赖）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  fitPopoverHeight,
  fitPopoverWidth,
  mobileProjectTab,
  projectSection,
} from '../src/lib/layout.ts'

const base = '/projects/PRJ-0001'

const sections = [
  ['项目资产', base, '/projects/PRJ-0001/assets/text', 'project-assets'],
  ['项目资产（会话）', `${base}/s/3`, '/projects/PRJ-0001/s/3/assets/image', 'project-assets'],
  ['分集列表', base, '/projects/PRJ-0001/episodes', 'episode-list'],
  ['分集列表（会话）', `${base}/s/3`, '/projects/PRJ-0001/s/3/episodes', 'episode-list'],
  ['分集资产', base, '/projects/PRJ-0001/episodes/EP01/assets/video', 'episode-assets'],
  [
    '分集资产（会话）',
    `${base}/s/3`,
    '/projects/PRJ-0001/s/3/episodes/EP01/assets/text',
    'episode-assets',
  ],
  ['其他', base, '/projects/PRJ-0001/unknown', 'other'],
]

let failed = 0
for (const [name, prefix, pathname, expected] of sections) {
  try {
    assert.equal(projectSection(pathname, prefix), expected)
    console.log(`✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${name}`)
    console.error(error)
  }
}

const tabs = [
  ['资产栏 · 项目资产', 'project-assets', 'assets', 'assets'],
  ['资产栏 · 分集列表', 'episode-list', 'assets', 'episodes'],
  ['资产栏 · 分集资产', 'episode-assets', 'assets', 'assets'],
  ['助手覆盖资产栏', 'episode-list', 'agent', 'agent'],
]

for (const [name, section, pane, expected] of tabs) {
  try {
    assert.equal(mobileProjectTab(section, pane), expected)
    console.log(`✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${name}`)
    console.error(error)
  }
}

const popovers = [
  ['宽屏保持请求宽度', fitPopoverWidth(400, 1440), 400],
  ['手机夹到视口内', fitPopoverWidth(400, 390), 374],
  ['极窄屏不会出现负宽度', fitPopoverWidth(400, 12), 0],
  ['高度扣除上下边距', fitPopoverHeight(800), 784],
]

for (const [name, actual, expected] of popovers) {
  try {
    assert.equal(actual, expected)
    console.log(`✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${name}`)
    console.error(error)
  }
}

// 项目页 basePath 带会话时，仍然能正确识别分集列表
assert.equal(
  projectSection('/projects/PRJ-0001/s/3/episodes', '/projects/PRJ-0001/s/3'),
  'episode-list',
)

if (failed > 0) process.exit(1)
console.log('\n响应式布局逻辑正常')
