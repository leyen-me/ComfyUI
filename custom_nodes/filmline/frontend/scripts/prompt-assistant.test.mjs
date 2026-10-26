/**
 * 提示词结构助手单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  alignmentInstruction,
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

// ── 官方规范：对齐句用真实时长、两位小数 ──────────────────────────────────
assert.ok(alignmentInstruction({ first: true, last: true }, 12).includes('12.00-second mark'))
assert.ok(alignmentInstruction({ first: false, last: true }, 5.17).includes('5.17-second mark'))
assert.ok(alignmentInstruction({ first: true, last: false }, 12).includes('(from [Shot 1]) is fully referenced'))
assert.equal(alignmentInstruction({ first: false, last: false }, 12), '')

// 模板必须吃真实时长，不能硬编码 5.00
const longTemplate = fullTemplate('video', 'keyframes', { first: true, last: true }, noCounts, 12)
assert.ok(longTemplate.includes('12.00-second mark'))
assert.ok(!longTemplate.includes('5.00-second mark'))
assert.ok(longTemplate.startsWith(alignmentInstruction({ first: true, last: true }, 12)))
// 对齐句与主体字段之间必须空一行
assert.ok(longTemplate.includes('target video.\n\nintegrated_multimodal_description:'))

// 参考模式不提供「不要字幕」片段（否则会多出第七段）
assert.ok(!snippetsFor('video', 'reference', counts).some((item) => item.id === 'no-sub'))
assert.ok(snippetsFor('video', 'keyframes', noCounts).some((item) => item.id === 'no-sub'))

// 参考模板带全局风格句
assert.ok(refTemplate.includes('slightly desaturated'))

// ── Lint 新规则 ──────────────────────────────────────────────────────────
const refPrompt = (body) =>
  'subject_definitions:\n<Subject 1> is the woman in <Picture 1>.\nsummary:\n[reference generation] ...\nretention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - identity kept.\ndetailed_description:\n' +
  body +
  '\noverall_soundscape: Rain.\nnon_diegetic_music: N/A'

// 逐秒列表
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] The woman stands.\n00:01.0 — she raises her hand.'),
    counts,
  }).some((item) => item.id === 'per-second'),
)

// summary 缺方括号任务类型
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] The woman stands in the rain.').replace(
      '[reference generation] ...',
      'A short vertical shot.',
    ),
    counts,
  }).some((item) => item.id === 'summary-type'),
)

// 参考模式出现禁止字幕段
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] The woman stands.') + '\nNo subtitles, no captions, no on-screen text.',
    counts,
  }).some((item) => item.id === 'ref-subtitle'),
)

// retention_analysis 行格式 / 不写 (Sx)
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] x').replace(
      '<Subject 1> (appears in [Shot 1]): fully_preserved - identity kept.',
      '<Subject 1> (S1) — identity: fully_preserved from <Picture 1>.',
    ),
    counts,
  }).some((item) => item.id === 'retention-line'),
)

// retention_analysis 里多出 subject_definitions 未定义的条目
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] <Subject 1> stands in the rain.').replace(
      '<Subject 1> (appears in [Shot 1]): fully_preserved - identity kept.',
      '<Subject 1> (appears in [Shot 1]): fully_preserved - identity kept.\n<Picture 1>: attribute_transfer - face transferred to <Subject 1>.',
    ),
    counts,
  }).some((item) => item.id === 'retention-labels'),
)
// 标签与定义一致时不报
assert.ok(
  !lintPrompt({
    mode: 'video',
    videoMode: 'reference',
    prompt: refPrompt('[Shot 1] <Subject 1> stands in the rain.'),
    counts,
  }).some((item) => item.id === 'retention-labels'),
)

// 正文不点名 Subject / Picture
const noSubject = lintPrompt({
  mode: 'video',
  videoMode: 'reference',
  prompt: refPrompt('[Shot 1] The woman stands in the rain and lifts her hand.'),
  counts,
})
assert.ok(noSubject.some((item) => item.id === 'subject-density'))
// 图片只作外观来源时，正文不引用 <Picture N> 是正常写法，不应误报
assert.ok(!noSubject.some((item) => item.id === 'picture-in-body'))

// 图片被声明为帧锚点却不在正文引用 → 提示
const anchorNotUsed = lintPrompt({
  mode: 'video',
  videoMode: 'reference',
  prompt: refPrompt('[Shot 1] The woman stands in the rain.').replace(
    '<Subject 1> is the woman in <Picture 1>.',
    '<Subject 1> is the woman in <Picture 1>.\n<Picture 2> is the first frame of [Shot 1].',
  ),
  counts,
})
assert.ok(anchorNotUsed.some((item) => item.id === 'picture-in-body'))

// 对齐句占位符与时长不一致
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: 'How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] x',
    counts: noCounts,
    duration: 5.17,
  }).some((item) => item.id === 'alignment-placeholder'),
)
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: 'How the reference pictures align with the target video — Picture 2 aligns with the 5.00-second mark of the target video.\n\nintegrated_multimodal_description: [Shot 1] x',
    counts: noCounts,
    duration: 5.17,
  }).some((item) => item.id === 'alignment-duration'),
)

// 台词按镜头时长估算
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt:
      'integrated_multimodal_description: [Shot 1] <d>[Chinese] 我们今天必须把所有事情都做完然后再回家吃饭</d> (S1) says\nNo subtitles',
    counts: noCounts,
    duration: 2,
  }).some((item) => item.id === 'dialogue-length'),
)

// 一镜到底却又写多镜头
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: 'one continuous shot, no cut\n[Shot 1] ...\n[Shot 2] At 00:02.000, the camera cuts to ...',
    counts: noCounts,
  }).some((item) => item.id === 'cut-conflict'),
)

// 首尾帧双图写了多镜头又没说明切点
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt:
      'integrated_multimodal_description: [Shot 1] A cyclist opens an umbrella.\n[Shot 2] At 00:03.000, the camera cuts to the handle.',
    counts: noCounts,
    keyframes: { first: true, last: true },
  }).some((item) => item.id === 'keyframe-no-cut'),
)
// 单镜头首尾帧不应要求写 no cut
assert.ok(
  !lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: 'integrated_multimodal_description: [Shot 1] A cyclist opens an umbrella.',
    counts: noCounts,
    keyframes: { first: true, last: true },
  }).some((item) => item.id === 'keyframe-no-cut'),
)

// 超过官方 7000 字符上限
assert.ok(
  lintPrompt({
    mode: 'video',
    videoMode: 'keyframes',
    prompt: 'x'.repeat(7001),
    counts: noCounts,
  }).some((item) => item.id === 'length-hard'),
)

console.log('提示词规范校验通过')
