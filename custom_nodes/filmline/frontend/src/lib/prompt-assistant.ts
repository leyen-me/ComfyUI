/** 提示词结构助手：纯函数生成模板、快捷片段与格式检查。 */

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
}

const QUOTED = /[“"]([^”"]+)[”"]/g
const DIALOGUE = /<d>[\s\S]*?<\/d>/i
const SPEAKER = /\(S\d+[^)]*\)/
const NO_SUBTITLE = /no subtitles|no captions|no on-screen text|不要字幕|无字幕/i
const VIDEO_TAG = /<(?:Picture|Video|Audio)\s+\d+>/i
const LEGACY_IMAGE_TAG = /<image\d+>/i
const CN_FIGURE = /图\s*\d+/
const SHOT = /\[Shot\s+1\]/i

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
    return [
      {
        id: 'subject_definitions',
        title: 'subject_definitions',
        hint: '定义参考素材各自负责什么',
        template:
          'subject_definitions:\n<Subject 1> is the ... in <Picture 1>, with ... .\n<Video 1> provides the ... .\n<Audio 1> is the ... reference for <Subject 1> (S1).',
      },
      {
        id: 'summary',
        title: 'summary',
        hint: '任务类型 + 目标视频 + 参考关系',
        template:
          'summary:\n[reference generation] The target video shows <Subject 1> ...',
      },
      {
        id: 'retention_analysis',
        title: 'retention_analysis',
        hint: '每个标签保留什么、改变什么',
        template:
          'retention_analysis:\n<Subject 1> (appears in [Shot 1]): fully_preserved - ...\n<Video 1> (camera movement): weak_reference - ...\n<Audio 1>: reference - ...',
      },
      {
        id: 'detailed_description',
        title: 'detailed_description',
        hint: '按镜头写画面、动作、说话人与声音',
        template:
          'detailed_description:\nThe target video is in a cinematic style.\n[Shot 1] <Subject 1> (S1) ... says: <d>[Chinese] ...</d>\nThe other subject remains silent.',
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
  }

  const alignment = keyframes.first && keyframes.last
    ? 'How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from [Shot 1]) aligns with the 5.00-second mark of the target video.'
    : keyframes.first
      ? 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
      : keyframes.last
        ? 'How the reference pictures align with the target video — <Picture 1> (from [Shot 1]) aligns with the 5.00-second mark of the target video.'
        : ''

  return [
    ...(alignment
      ? [
          {
            id: 'alignment',
            title: '首尾帧对齐',
            hint: '官方对齐指令，放在提示词第一行',
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
    { id: 'no-sub', label: '不要字幕', text: 'No subtitles, no captions, no on-screen text.', block: true },
    { id: 'shot', label: '[Shot]', text: '[Shot 2] At 00:03.500, the camera cuts to ...' },
    {
      id: 'camera',
      label: '运镜',
      text: 'The camera pushes in with small amplitude at slow speed ...',
      block: true,
    },
    { id: 'soundscape', label: '环境声', text: 'overall_soundscape: ...', block: true },
    { id: 'music', label: '配乐', text: 'non_diegetic_music: N/A', block: true },
  ]

  if (videoMode === 'reference') {
    items.unshift(
      { id: 'picture', label: '<Picture 1>', text: '<Picture 1>' },
      { id: 'video', label: '<Video 1>', text: '<Video 1>' },
      { id: 'audio', label: '<Audio 1>', text: '<Audio 1>' },
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
    return [
      'subject_definitions:',
      '<Subject 1> is the ... in <Picture 1>, with ... .',
      '<Video 1> provides the ... .',
      '<Audio 1> is the ... reference for <Subject 1> (S1).',
      '',
      'summary:',
      '[reference generation] The target video shows <Subject 1> ...',
      '',
      'retention_analysis:',
      '<Subject 1> (appears in [Shot 1]): fully_preserved - ...',
      '<Video 1> (camera movement): weak_reference - ...',
      '<Audio 1>: reference - ...',
      '',
      'detailed_description:',
      'The target video is in a cinematic style.',
      '[Shot 1] <Subject 1> (S1) ... says: <d>[Chinese] ...</d>',
      'The other subject remains silent.',
      '',
      'overall_soundscape: ...',
      '',
      'non_diegetic_music: N/A',
    ].join('\n')
  }

  const alignment = sectionsFor(mode, videoMode, keyframes, counts).find(
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

export function lintPrompt({ mode, videoMode, prompt, counts }: LintInput): PromptWarning[] {
  const warnings: PromptWarning[] = []
  const text = prompt.trim()

  if (text.length > 4000) {
    warnings.push({
      id: 'length',
      level: 'error',
      message: `提示词 ${text.length} 字符，超过 4000 上限。`,
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
  if (dialogue && !noSubtitle) {
    warnings.push({
      id: 'subtitle',
      level: 'warn',
      message: '有对白但没有明确禁止字幕；如果不要字幕，补 No subtitles, no captions, no on-screen text.',
    })
  }
  if (videoMode === 'reference' && total(counts) > 0 && text.length > 0 && !VIDEO_TAG.test(text)) {
    warnings.push({
      id: 'ref-tag',
      level: 'warn',
      message: '参考托盘已有素材，但提示词里没有 <Picture N>/<Video N>/<Audio N> 引用。',
    })
  }
  if (CN_FIGURE.test(text)) {
    warnings.push({
      id: 'cn-figure',
      level: 'warn',
      message: 'H3 视频使用 <Picture N>，不是「图1」；请检查引用标签。',
    })
  }
  if (videoMode === 'keyframes' && text.length > 20 && !SHOT.test(text)) {
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

  return warnings
}
