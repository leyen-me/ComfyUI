/** 提示词结构助手：纯函数生成模板、快捷片段与格式检查。 */

// 纯函数模块被 node 单测直接执行，相对导入需要写扩展名
import { PROMPT_HARD_LIMIT_CHARS, PROMPT_SOFT_HINT_CHARS } from './limits.ts'

export type AssistantMode = 'image' | 'video'
export type AssistantVideoMode = 'keyframes' | 'reference'

export interface AssistantCounts {
  images: number
  videos: number
  audios: number
}

export interface AssistantKeyframes {
  first: boolean
  last: boolean
}

export interface AssistantSection {
  id: string
  title: string
  hint: string
  template: string
}

export interface AssistantSnippet {
  id: string
  label: string
  text: string
  /** 多行模板用块插入，单行标签用行内插入 */
  block?: boolean
}

export interface PromptWarning {
  id: string
  level: 'warn' | 'error'
  message: string
}

export interface LintInput {
  mode: AssistantMode
  videoMode: AssistantVideoMode
  prompt: string
  counts: AssistantCounts
  /** 帧对齐后的真实时长（秒）；缺省时不校验对齐句时长 */
  duration?: number
  /** 首/尾帧状态；缺省时不做一镜到底校验 */
  keyframes?: AssistantKeyframes
}

const QUOTED = /[“"]([^”"]+)[”"]/g
const DIALOGUE = /<d>[\s\S]*?<\/d>/i
const DIALOGUE_BLOCKS = /<d>([\s\S]*?)<\/d>/gi
const SPEAKER = /\(S\d+[^)]*\)/
const NO_SUBTITLE = /no subtitles|no captions|no on-screen text|不要字幕|无字幕/i
const NO_CUT = /no cut|without cutting|one continuous shot|single continuous shot|不要切镜|一镜到底|不切镜/i
const VIDEO_TAG = /<(?:Picture|Video|Audio)\s+\d+>/i
const PICTURE_TAG = /<Picture\s+\d+>/i
const LEGACY_IMAGE_TAG = /<image\d+>/i
const CN_FIGURE = /图\s*\d+/
const SHOT = /\[Shot\s+1\]/i
const EXTRA_SHOT = /\[Shot\s+[2-9]\d*\]/i
const PER_SECOND_BULLET = /^[ \t]*\d{1,2}:\d{2}(?:\.\d{1,3})?[ \t]*[—–-]/m
const SUMMARY_TYPE = /(^|\n)[ \t]*summary:[ \t]*\n?[ \t]*\[/
const ALIGNMENT_PLACEHOLDER = /\bS\.SS\b/
const ALIGNMENT_SECONDS = /(\d+\.\d{2})-second mark/g
const SCENETRANS = /<scenetrans>/g
const SPEAKER_IN_RETENTION = /\(S\d+\)/
const TAG_LABEL = /<(Subject|Picture|Video|Audio)\s+(\d+)>/g
const REF_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const
const RETENTION_MARKER =
  /:\s*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)\s*-\s/i
const SUBJECT_TAG = /<Subject\s+\d+>/i
const PICTURE_ANCHOR =
  /<Picture\s+\d+>[^\n]*(first frame|keyframe|last frame|composition anchor|begins from|ends on)|(first frame|keyframe|last frame|composition anchor)[^\n]*<Picture\s+\d+>/i

/** 官方固定写法的首/尾帧对齐指令；时长固定两位小数（与后端 llm.py 一致）。 */
export function alignmentInstruction(
  keyframes: AssistantKeyframes,
  duration = 5,
): string {
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 5
  const mark = seconds.toFixed(2)
  if (keyframes.first && keyframes.last) {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the ${mark}-second mark of the target video.`
  }
  if (keyframes.first) {
    return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
  }
  if (keyframes.last) {
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the ${mark}-second mark of the target video.`
  }
  return ''
}

function hasQuotedDialogue(prompt: string): boolean {
  QUOTED.lastIndex = 0
  return QUOTED.test(prompt)
}

function total(counts: AssistantCounts): number {
  return counts.images + counts.videos + counts.audios
}

export function modeHint(
  mode: AssistantMode,
  videoMode: AssistantVideoMode,
  keyframes: AssistantKeyframes,
): string {
  if (mode === 'image') {
    return '图片模式：主体 + 构图 + 环境 + 风格光线 + 约束；参考图用编辑器的图片块。'
  }
  if (videoMode === 'reference') {
    return '参考模式：先定义 <Subject>/<Picture>/<Video>/<Audio> 的角色，再写保留关系和时间轴。'
  }
  if (keyframes.first && keyframes.last) {
    return '首尾帧：重点写从首帧到尾帧的动作路径，不要让结尾切走。'
  }
  if (keyframes.first) {
    return '首帧：从首帧的画面状态出发，写清楚下一步动作和镜头。'
  }
  if (keyframes.last) {
    return '尾帧：从合理的前置状态出发，让最后一个镜头落到尾帧。'
  }
  return '文生视频：按 画面 → 动作 → 镜头 → 声音 的顺序写。'
}

export function sectionsFor(
  mode: AssistantMode,
  videoMode: AssistantVideoMode,
  keyframes: AssistantKeyframes,
  _counts: AssistantCounts,
  duration = 5,
): AssistantSection[] {
  if (mode === 'image') {
    return [
      {
        id: 'subject',
        title: '主体与动作',
        hint: '谁/什么，在做什么，表情与姿态',
        template: '主体：...\n动作与表情：...',
      },
      {
        id: 'composition',
        title: '构图与视角',
        hint: '景别、机位、主体位置、前后景',
        template: '构图：...\n视角与景别：...',
      },
      {
        id: 'environment',
        title: '环境与道具',
        hint: '场景、光线、关键道具、时间天气',
        template: '环境：...\n光线与色彩：...',
      },
      {
        id: 'style',
        title: '风格与质感',
        hint: '写实/动画/胶片、材质、镜头质感',
        template: '风格：...\n质感与细节：...',
      },
      {
        id: 'constraints',
        title: '约束',
        hint: '需要保持的参考特征、不要出现的元素',
        template: '保持：...\n避免：...',
      },
    ]
  }

  if (videoMode === 'reference') {
    const sections: AssistantSection[] = [
      {
        id: 'subject_definitions',
        title: 'subject_definitions',
        hint: '定义参考素材各自负责什么；动作参考要挂到 Subject 上，未使用的标签行删掉',
        template:
          'subject_definitions:\n<Subject 1> is the ... in <Picture 1>, with ... . Its body motion comes from <Video 1>.\n<Video 1> is the motion reference for <Subject 1>; only body motion and camera framing are used.\n<Audio 1> is the ... reference for <Subject 1> (S1).',
      },
      {
        id: 'summary',
        title: 'summary',
        hint: '任务类型 + 目标视频 + 参考关系；角色设定图要说明画面里只出现一个角色',
        template:
          'summary:\n[reference generation] The target video shows one instance of <Subject 1> ...',
      },
      {
        id: 'retention_analysis',
        title: 'retention_analysis',
        hint: '每个标签保留什么、改变什么；动作参考用 attribute_transfer',
        template:
          'retention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - ...\n<Video 1> (body motion): attribute_transfer - ... motion transferred onto <Subject 1>; the source body and background are replaced.\n<Audio 1>: reference - ...',
      },
      {
        id: 'detailed_description',
        title: 'detailed_description',
        hint: '先写 1–2 句全局风格，再按镜头写散文；动作参考补时间点姿态，并写明画面里只有一个角色',
        template:
          'detailed_description:\nThe target video is in a cinematic style with soft lighting and a slightly desaturated palette.\n[Shot 1] The shot begins from <Picture 1>. The frame contains only <Subject 1>, who keeps the identity established by <Picture 1>. <Subject 1> (S1) ... At 00:02.0 both arms extend outward ... At 00:04.5 says: <d>[Chinese] ...</d>',
      },
      {
        id: 'overall_soundscape',
        title: 'overall_soundscape',
        hint: '环境声、动作声、非语言人声',
        template: 'overall_soundscape: ...',
      },
      {
        id: 'non_diegetic_music',
        title: 'non_diegetic_music',
        hint: '只有观众能听到的配乐；没有就写 N/A',
        template: 'non_diegetic_music: N/A',
      },
    ]

    return sections
  }

  const alignment = alignmentInstruction(keyframes, duration)

  return [
    ...(alignment
      ? [
          {
            id: 'alignment',
            title: '首尾帧对齐',
            hint: '官方对齐指令，放在提示词第一行，后面空一行',
            template: alignment,
          },
        ]
      : []),
    {
      id: 'opening',
      title: '画面与首帧',
      hint: '风格、主体、构图、首帧状态',
      template:
        'integrated_multimodal_description: [Shot 1] Live-action, cinematic, ...',
    },
    {
      id: 'action',
      title: '动作路径',
      hint: '从首帧出发，写中间变化和结果',
      template:
        'The camera pushes in with small amplitude at slow speed as ... . Toward the end, ... .',
    },
    {
      id: 'dialogue',
      title: '对白',
      hint: '说话人 ID + <d> 包裹原语言台词',
      template:
        'The subject (S1) is the only speaker: its mouth moves as it says: <d>[Chinese] ...</d>\nThe other subject remains silent with its mouth closed.',
    },
    {
      id: 'soundscape',
      title: '环境声',
      hint: '1–4 句环境声、动作声',
      template: 'overall_soundscape: ...',
    },
    {
      id: 'music',
      title: '配乐',
      hint: '只有观众能听到的配乐；没有写 N/A',
      template: 'non_diegetic_music: N/A',
    },
    {
      id: 'constraints',
      title: '禁止项',
      hint: '不要字幕、不要屏幕文字等',
      template: 'No subtitles, no captions, no on-screen text.',
    },
  ]
}

export function snippetsFor(
  mode: AssistantMode,
  videoMode: AssistantVideoMode,
  counts: AssistantCounts,
): AssistantSnippet[] {
  if (mode === 'image') {
    return [
      { id: 'subject', label: '主体', text: '主体：' },
      { id: 'composition', label: '构图', text: '构图：' },
      { id: 'lighting', label: '光线', text: '光线：' },
      { id: 'style', label: '风格', text: '风格：' },
      { id: 'avoid', label: '避免', text: '避免：' },
    ]
  }

  const items: AssistantSnippet[] = [
    { id: 'd', label: '<d> 对白', text: '<d>[Chinese] 台词</d>' },
    { id: 'speaker', label: '(S1)', text: ' (S1)' },
    { id: 'shot', label: '[Shot]', text: '[Shot 2] At 00:03.500, the camera cuts to ...' },
    {
      id: 'camera',
      label: '运镜',
      text: 'The camera pushes in with small amplitude at slow speed ...（环绕更稳的写法是 truck left + pan right）',
      block: true,
    },
    { id: 'soundscape', label: '环境声', text: 'overall_soundscape: ...', block: true },
    { id: 'music', label: '配乐', text: 'non_diegetic_music: N/A', block: true },
  ]

  // 参考模式只有六段，末尾不允许再追加禁止字幕段
  if (videoMode !== 'reference') {
    items.splice(2, 0, {
      id: 'no-sub',
      label: '不要字幕',
      text: 'No subtitles, no captions, no on-screen text.',
      block: true,
    })
  }

  if (videoMode === 'reference') {
    items.unshift(
      { id: 'picture', label: '<Picture 1>', text: '<Picture 1>' },
      { id: 'video', label: '<Video 1>', text: '<Video 1>' },
      { id: 'audio', label: '<Audio 1>', text: '<Audio 1>' },
    )
    items.push(
      {
        id: 'motion-beats',
        label: '动作节拍',
        text: 'At 00:00.8 ..., At 00:02.0 ..., At 00:04.5 ...',
        block: true,
      },
      {
        id: 'single-subject',
        label: '只出现一个角色',
        text: 'The frame contains only <Subject 1>.',
        block: true,
      },
    )
    if (total(counts) === 0) {
      items.push({
        id: 'ref-hint',
        label: '参考提示',
        text: '先在右侧托盘加入图片/视频/音频，再在提示词里引用标签。',
        block: true,
      })
    }
  }

  return items
}

export function fullTemplate(
  mode: AssistantMode,
  videoMode: AssistantVideoMode,
  keyframes: AssistantKeyframes,
  counts: AssistantCounts,
  duration = 5,
): string {
  if (mode === 'image') {
    return [
      '主体：...',
      '构图与视角：...',
      '环境与光线：...',
      '风格与质感：...',
      '保持：...',
      '避免：...',
    ].join('\n')
  }

  if (videoMode === 'reference') {
    const sections = [
      'subject_definitions:',
      '<Subject 1> is the ... in <Picture 1>, with ... . Its body motion comes from <Video 1>.',
      '<Video 1> is the motion reference for <Subject 1>; only body motion and camera framing are used.',
      '<Audio 1> is the ... reference for <Subject 1> (S1).',
      '',
      'summary:',
      '[reference generation] The target video shows one instance of <Subject 1> ...',
      '',
      'retention_analysis:',
      '<Subject 1> (appears in [Shot 1]): fully_preserved - ...',
      '<Video 1> (body motion): attribute_transfer - ... motion transferred onto <Subject 1>; the source body and background are replaced.',
      '<Audio 1>: reference - ...',
      '',
      'detailed_description:',
      'The target video is in a cinematic style with soft lighting and a slightly desaturated palette.',
      '[Shot 1] The shot begins from <Picture 1>. The frame contains only <Subject 1>, who keeps the identity established by <Picture 1>. <Subject 1> (S1) ... At 00:02.0 both arms extend outward ... At 00:04.5 says: <d>[Chinese] ...</d>',
      '',
      'overall_soundscape: ...',
      '',
      'non_diegetic_music: N/A',
    ]
    return sections.join('\n')
  }

  const alignment = sectionsFor(mode, videoMode, keyframes, counts, duration).find(
    (section) => section.id === 'alignment',
  )?.template

  return [
    ...(alignment ? [alignment, ''] : []),
    'integrated_multimodal_description: [Shot 1] Live-action, cinematic, ...',
    'The camera pushes in with small amplitude at slow speed as ... .',
    'The subject (S1) is the only speaker: its mouth moves as it says: <d>[Chinese] ...</d>',
    'The other subject remains silent with its mouth closed.',
    '',
    'overall_soundscape: ...',
    '',
    'non_diegetic_music: N/A',
    '',
    'No subtitles, no captions, no on-screen text.',
  ].join('\n')
}

/** 按官方经验值估算台词时长：中文 4.5 字/秒、英文 2.7 词/秒。 */
function dialogueSeconds(prompt: string): number {
  let cjk = 0
  let words = 0
  for (const match of prompt.matchAll(DIALOGUE_BLOCKS)) {
    const body = (match[1] ?? '').replace(/\[[A-Za-z ]+\]/g, ' ')
    cjk += (body.match(/[\u4e00-\u9fff]/g) ?? []).length
    words += (body.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length
  }
  return cjk / 4.5 + words / 2.7
}

export function lintPrompt({
  mode,
  videoMode,
  prompt,
  counts,
  duration,
  keyframes,
}: LintInput): PromptWarning[] {
  const warnings: PromptWarning[] = []
  const text = prompt.trim()

  if (text.length > PROMPT_HARD_LIMIT_CHARS) {
    warnings.push({
      id: 'length-hard',
      level: 'warn',
      message: `提示词 ${text.length} 字符，超过 H3 官方上限 ${PROMPT_HARD_LIMIT_CHARS}；请删减，否则可能被截断。`,
    })
  } else if (text.length > PROMPT_SOFT_HINT_CHARS) {
    warnings.push({
      id: 'length',
      level: 'warn',
      message: `提示词 ${text.length} 字符，偏长；不影响生成，但可能稀释注意力、拖慢编码。`,
    })
  }

  if (mode === 'image') {
    if (DIALOGUE.test(text) || VIDEO_TAG.test(text)) {
      warnings.push({
        id: 'image-tags',
        level: 'warn',
        message: '图片模式不要使用视频标签（<Picture>/<Video>/<Audio>/<d>）；参考图用输入框里的图片块。',
      })
    }
    if (text.length > 0 && text.length < 6) {
      warnings.push({
        id: 'image-short',
        level: 'warn',
        message: '提示词较短，建议补充主体、构图和风格光线。',
      })
    }
    return warnings
  }

  const quoted = hasQuotedDialogue(text)
  const dialogue = DIALOGUE.test(text)
  const speaker = SPEAKER.test(text)
  const noSubtitle = NO_SUBTITLE.test(text)

  if (quoted && !dialogue) {
    warnings.push({
      id: 'quoted',
      level: 'warn',
      message: '检测到裸引号对白：H3 可能把台词渲染成画面字幕。建议改成 <d>[Chinese] ...</d>。',
    })
  }
  if (dialogue && !speaker) {
    warnings.push({
      id: 'speaker',
      level: 'warn',
      message: '有对白但没有说话人 ID；建议写 (S1)，并说明谁在说话、谁闭嘴。',
    })
  }
  // 参考模式只有六段，官方不允许在 non_diegetic_music 之后追加禁止字幕段
  if (videoMode !== 'reference' && dialogue && !noSubtitle) {
    warnings.push({
      id: 'subtitle',
      level: 'warn',
      message: '有对白但没有明确禁止字幕；如果不要字幕，补 No subtitles, no captions, no on-screen text.',
    })
  }
  if (videoMode === 'reference' && /(^|\n)[ \t]*no subtitles[^\n]*$/im.test(text)) {
    warnings.push({
      id: 'ref-subtitle',
      level: 'warn',
      message: '参考模式是六段式，结尾不应出现 No subtitles 段；删掉它，或把要求写进 detailed_description。',
    })
  }
  if (PER_SECOND_BULLET.test(text)) {
    warnings.push({
      id: 'per-second',
      level: 'warn',
      message:
        '检测到逐秒列表（如 00:01.0 — ...）：官方要的是连续镜头散文，只在切镜和必要节拍写 At MM:SS.mmm。',
    })
  }
  if (ALIGNMENT_PLACEHOLDER.test(text)) {
    warnings.push({
      id: 'alignment-placeholder',
      level: 'warn',
      message: '对齐句里还留着 S.SS 占位符；请填成真实时长（两位小数，如 5.17）。',
    })
  }
  if (
    typeof duration === 'number' &&
    duration > 0 &&
    /aligns with the/i.test(text)
  ) {
    const marks = [...text.matchAll(ALIGNMENT_SECONDS)]
      .map((match) => Number(match[1]))
      // 首帧固定写 0.00-second mark，它不是视频时长
      .filter((value) => value > 0)
    const expected = duration.toFixed(2)
    const wrong = marks.filter((value) => Math.abs(value - duration) > 0.005)
    if (wrong.length > 0) {
      warnings.push({
        id: 'alignment-duration',
        level: 'warn',
        message: `对齐句写的时长和面板不一致：应为 ${expected} 秒（对齐后 ${duration.toFixed(2)}s）。`,
      })
    }
  }
  if (videoMode === 'reference') {
    if (text.includes('summary:') && !SUMMARY_TYPE.test(text)) {
      warnings.push({
        id: 'summary-type',
        level: 'warn',
        message: 'summary 开头要用方括号标任务类型，如 [reference generation] 或 [video editing + audio reuse]。',
      })
    }
  }
  if (dialogue && SCENETRANS.test(text)) {
    const blocks = [...text.matchAll(DIALOGUE_BLOCKS)].map((match) => match[1] ?? '')
    const odd = blocks.some((block) => (block.match(/<scenetrans>/g) ?? []).length % 2 === 1)
    if (odd) {
      warnings.push({
        id: 'scenetrans',
        level: 'warn',
        message: '<scenetrans> 没有成对：同一句台词被切镜拆开时，前段结尾和后段开头各写一个。',
      })
    }
  }
  if (NO_CUT.test(text) && EXTRA_SHOT.test(text)) {
    warnings.push({
      id: 'cut-conflict',
      level: 'warn',
      message: '同时声明了「一镜到底/不要切镜」又写了 [Shot 2] 及之后；两者矛盾，删掉其中一个。',
    })
  }
  if (dialogue) {
    const estimate = dialogueSeconds(text)
    if (typeof duration === 'number' && duration > 0 && estimate > duration * 1.1) {
      warnings.push({
        id: 'dialogue-length',
        level: 'warn',
        message: `台词约 ${estimate.toFixed(1)} 秒，超过镜头 ${duration.toFixed(2)} 秒；口型容易对不上，建议删短台词或加镜头。`,
      })
    }
  }
  if (
    videoMode === 'reference' &&
    total(counts) > 0 &&
    text.length > 0 &&
    !VIDEO_TAG.test(text)
  ) {
    warnings.push({
      id: 'ref-tag',
      level: 'warn',
      message: '参考托盘已有素材，但提示词里没有 <Picture N>/<Video N>/<Audio N> 引用。',
    })
  }
  if (videoMode === 'reference' && text.length > 0) {
    const missing = REF_SECTIONS.filter(
      (section) => !new RegExp(`(^|\\n)\\s*${section}\\s*:`).test(text),
    )
    if (missing.length > 0) {
      warnings.push({
        id: 'ref-sections',
        level: 'warn',
        message: `官方参考模式要求六段：缺少 ${missing.join(' / ')}。`,
      })
    }
    const definitionsBlock =
      text.split(/subject_definitions:/i)[1]?.split(/summary:/i)[0] ?? ''
    const retentionBlock =
      text.split(/retention_analysis:/i)[1]?.split(/detailed_description:/i)[0] ?? ''
    if (text.includes('retention_analysis') && !RETENTION_MARKER.test(retentionBlock)) {
      warnings.push({
        id: 'retention-marker',
        level: 'warn',
        message:
          'retention_analysis 需要官方标记：fully_preserved / partially_preserved / attribute_transfer / weak_reference，音频用 fully_copy / partially_copy / reference。',
      })
    }
    if (text.includes('retention_analysis')) {
      const lines = retentionBlock
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('<'))
      const badLine = lines.some(
        (line) => !RETENTION_MARKER.test(line) || SPEAKER_IN_RETENTION.test(line),
      )
      if (badLine) {
        warnings.push({
          id: 'retention-line',
          level: 'warn',
          message:
            'retention_analysis 每行必须是 <标签> (作用范围): 标记 - 说明；不写 (Sx)，也不插其他散文。',
        })
      }
      const definedLabels = new Set(
        definitionsBlock
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.startsWith('<'))
          .map((line) => line.match(/^<(Subject|Picture|Video|Audio)\s+(\d+)>/))
          .filter((match): match is RegExpMatchArray => match !== null)
          .map((match) => `${match[1]} ${match[2]}`),
      )
      const extraLabels = [
        ...new Set([...retentionBlock.matchAll(TAG_LABEL)].map((m) => `${m[1]} ${m[2]}`)),
      ].filter((label) => !definedLabels.has(label))
      if (definedLabels.size > 0 && extraLabels.length > 0) {
        warnings.push({
          id: 'retention-labels',
          level: 'warn',
          message: `retention_analysis 多出未定义的条目：${extraLabels
            .map((label) => `<${label}>`)
            .join(' ')}；这里的标签必须与 subject_definitions 完全一致。`,
        })
      }
    }
    const descriptionBlock =
      text.split(/detailed_description:/i)[1]?.split(/overall_soundscape:/i)[0] ?? ''
    if (
      text.includes('detailed_description:') &&
      SUBJECT_TAG.test(text) &&
      !SUBJECT_TAG.test(descriptionBlock)
    ) {
      warnings.push({
        id: 'subject-density',
        level: 'warn',
        message: 'detailed_description 里没有引用任何 <Subject N>；每个动作节拍都应点名标签，参考强度会更高。',
      })
    }
    // 只有把图片当成具体帧/构图锚点时，正文才需要引用 <Picture N>；
    // 图片仅作为外观来源时由 <Subject N> 承担引用，正文不写图片标签是正常写法。
    if (
      text.includes('detailed_description:') &&
      PICTURE_ANCHOR.test(definitionsBlock) &&
      !PICTURE_TAG.test(descriptionBlock)
    ) {
      warnings.push({
        id: 'picture-in-body',
        level: 'warn',
        message:
          'subject_definitions 把某张图声明为帧锚点，但正文没有引用 <Picture N>；请写 the shot begins from <Picture 1> 这类固定表达。',
      })
    }
    if (total(counts) > 0 && !SUBJECT_TAG.test(text)) {
      warnings.push({
        id: 'subject-tag',
        level: 'warn',
        message:
          '建议把角色/动作写成 <Subject N>：外观可来自 <Picture N>，动作来自 <Video N>；否则模型容易把视频当成风格参考。',
      })
    }
  }
  if (CN_FIGURE.test(text)) {
    warnings.push({
      id: 'cn-figure',
      level: 'warn',
      message: 'H3 视频使用 <Picture N>，不是「图1」；请检查引用标签。',
    })
  }
  if (videoMode !== 'reference' && text.length > 20 && !SHOT.test(text)) {
    warnings.push({
      id: 'shot',
      level: 'warn',
      message: '建议用 [Shot 1] 标注第一个镜头，方便模型按时间轴理解。',
    })
  }
  if (LEGACY_IMAGE_TAG.test(text)) {
    warnings.push({
      id: 'legacy-tag',
      level: 'warn',
      message: '视频模式不要使用 <imageN>；H3 使用 <Picture N>。',
    })
  }
  if (
    videoMode === 'keyframes' &&
    keyframes?.first &&
    keyframes?.last &&
    EXTRA_SHOT.test(text) &&
    !NO_CUT.test(text)
  ) {
    warnings.push({
      id: 'keyframe-no-cut',
      level: 'warn',
      message:
        '首尾帧双图默认单镜头（H3 不会自动加切镜），但提示词写了 [Shot 2] 及之后；确认是否有意，否则删掉多镜头或写明切点。',
    })
  }

  return warnings
}
