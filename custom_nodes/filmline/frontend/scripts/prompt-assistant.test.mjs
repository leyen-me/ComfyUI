/**
 * 提示词结构助手单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  fullTemplate,
  lintPrompt,
  modeHint,
  sectionsFor,
  snippetsFor,
} from '../src/lib/prompt-assistant.ts'

const counts = { images: 1, videos: 0, audios: 0 }
const noCounts = { images: 0, videos: 0, audios: 0 }
const keyframes = { first: true, last: false }

// 结构片段随模式变化
const imageSections = sectionsFor('image', 'keyframes', keyframes, noCounts)
assert.equal(imageSections.length, 5)
const keyframeSections = sectionsFor('video', 'keyframes', keyframes, noCounts)
assert.ok(keyframeSections.some((item) => item.id === 'alignment'))
assert.ok(keyframeSections.some((item) => item.id === 'dialogue'))
const referenceSections = sectionsFor('video', 'reference', keyframes, counts)
assert.equal(referenceSections.length, 6)
assert.deepEqual(
  referenceSections.map((item) => item.id),
  [
    'subject_definitions',
    'summary',
    'retention_analysis',
    'detailed_description',
    'overall_soundscape',
    'non_diegetic_music',
  ],
)
assert.ok(modeHint('video', 'keyframes', { first: true, last: true }).includes('动作路径'))

// 快速片段：参考模式必须带三类标签
const refSnippets = snippetsFor('video', 'reference', counts).map((item) => item.label)
assert.ok(refSnippets.includes('<Picture 1>'))
assert.ok(refSnippets.includes('<Video 1>'))
assert.ok(refSnippets.includes('<Audio 1>'))

// 完整模板
const template = fullTemplate('video', 'keyframes', keyframes, noCounts)
assert.ok(template.includes('<Picture 1>'))
assert.ok(template.includes('<d>[Chinese]'))
assert.ok(template.includes('overall_soundscape:'))
assert.ok(template.includes('No subtitles'))

// 参考模板：动作要挂到 Subject，并带官方保留标记
const refTemplate = fullTemplate('video', 'reference', keyframes, counts)
assert.ok(refTemplate.includes('Its body motion comes from <Video 1>'))
assert.ok(refTemplate.includes('attribute_transfer'))
assert.ok(refTemplate.includes('The frame contains only <Subject 1>'))
assert.ok(refTemplate.includes('At 00:02.0'))
assert.ok(
  snippetsFor('video', 'reference', counts).some((item) => item.id === 'motion-beats'),
)

// Lint：参考模式缺少官方六段
const missingSections = lintPrompt({
  mode: 'video',
  videoMode: 'reference',
  prompt: '<Subject 1> walks into the room.',
  counts,
})
assert.ok(missingSections.some((item) => item.id === 'ref-sections'))

// Lint：有 retention_analysis 但没有官方标记
const missingMarker = lintPrompt({
  mode: 'video',
  videoMode: 'reference',
  prompt:
    'subject_definitions:\n<Subject 1> in <Picture 1>.\nsummary:\n[reference generation] ...\nretention_analysis:\n<Subject 1> keeps the same look.\ndetailed_description:\n[Shot 1] ...\noverall_soundscape: room tone.\nnon_diegetic_music: N/A',
  counts,
})
assert.ok(missingMarker.some((item) => item.id === 'retention-marker'))

// Lint：裸引号
const quoted = lintPrompt({
  mode: 'video',
  videoMode: 'keyframes',
  prompt: '小狗对老鹰说：“上周去打篮球了而已！”',
  counts: noCounts,
})
assert.ok(quoted.some((item) => item.id === 'quoted'))

// Lint：有对白但没有说话人
const noSpeaker = lintPrompt({
  mode: 'video',
  videoMode: 'keyframes',
  prompt: '小狗说：<d>[Chinese] 你好</d>',
  counts: noCounts,
})
assert.ok(noSpeaker.some((item) => item.id === 'speaker'))
assert.ok(noSpeaker.some((item) => item.id === 'subtitle'))

// Lint：参考标签缺失
const missingRefTag = lintPrompt({
  mode: 'video',
  videoMode: 'reference',
  prompt: '<Subject 1> walks into the room.',
  counts,
})
assert.ok(missingRefTag.some((item) => item.id === 'ref-tag'))
assert.ok(
  !lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: 'The empty alley in <Picture 1>, camera pushes in slowly as the man enters.',
    counts,
  }).some((item) => item.id === 'shot'),
)

// Lint：图片模式不要使用视频标签
const imageLint = lintPrompt({
  mode: 'image',
  videoMode: 'keyframes',
  prompt: '把 <Picture 1> 的人物放到 <d>[Chinese] 场景</d>',
  counts: noCounts,
})
assert.ok(imageLint.some((item) => item.id === 'image-tags'))

// Lint：短提示词不误报 [Shot 1]
assert.ok(
  !lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: '镜头推近',
    counts: noCounts,
  }).some((item) => item.id === 'shot'),
)

// Lint：超长只是软提示，不再阻断
const long = lintPrompt({
  mode: 'video',
  videoMode: 'keyframes',
  prompt: 'x'.repeat(4100),
  counts: noCounts,
})
assert.ok(long.some((item) => item.level === 'warn' && item.id === 'length'))

console.log('提示词结构助手正常')
