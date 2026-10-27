---
id: h3-prompt
title: MiniMax H3 提示词
summary: MiniMax H3 视频提示词的官方规范：keyframes / reference 两种模式的结构、引用标签、台词、声音与硬限制。
when: 写或修改 create_video 的 prompt、用户问视频提示词怎么写、生成效果差需要排查提示词格式时。
version: 1
---
# MiniMax H3 提示词规范

H3 视频提示词只有两种结构。先按 `video_mode` 选对，再动笔：

- `keyframes`（首尾帧 / 纯文生视频）：首尾帧先写对齐 instruction，再写三个主体字段；纯文生视频没有 instruction。
- `reference`（全能参考）：六个段落，顺序固定。

规则来自官方《MiniMax H3 - 视频扩写 Prompt 写作全能指南》与《模型使用手册》；
标注「Filmline」的条目是本项目实现约定，与官方原文冲突时以标注为准。
正文用英文写；只有 `<d>` 内的台词、歌词，以及画面中实际可见的文字保留原语言。

## 1. 硬限制

- 提示词总长 ≤ **7000 字符**（官方上限）。超过约 4000 字符就开始稀释注意力，需要删重复，不要注水。
- 时长 5–15 秒、24fps；导出帧数向上对齐到 17k+5 网格，因此实际时长可能略长于设定值（Filmline）。
- 台词节奏：中文约 4.5 字/秒、英文约 2.7 词/秒（Filmline 估算）。台词明显超长就删短或加镜头，否则口型对不上。
- 首尾帧入口：图片 0、1、2 张，宽高比需在 5:2–2:5。
- 全能参考入口：图片 ≤9 张；视频 ≤3 段（单段 2–15 秒，总时长 ≤15 秒）；音频 ≤3 段，且必须配合图片或视频，不能单独输入；混合输入合计 ≤12 个文件。
- 篇幅参考：生成类任务的画面描述约 350–500 个英文单词；台词密集时以完整容纳台词时间线为先，不为了凑字数加废话。

## 2. 两种模式共用的写法

### 2.1 对齐 instruction（只用于首尾帧模式）

instruction 必须是最终提示词的第一行，后面空一行再写主体字段。三种情况用固定句式，
其中 `S.SS` 是视频有效时长，固定两位小数；`N` 是最后一个实际镜头的编号。

只有首帧（I2VA）：

```
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

首帧 + 尾帧（FL2VA）：

```
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

只有尾帧（L2VA）：

```
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

没有任何图片（纯文生视频）时不要写 instruction，直接从主体字段开始。
`<Picture 1>` 是首帧还是尾帧由模式决定：I2VA 属于 `[Shot 1]`，L2VA 属于最后一个 `[Shot N]`，
不是天然属于第一镜。

Filmline：`create_video` 的首尾帧对齐句由后端按真实时长确定性生成；写提示词时保留该行原样，
不要自己拼数字、不要改写措辞、不要留下 `S.SS` 占位符。

### 2.2 主体字段（首尾帧模式）

三个字段，顺序固定，每段以字段名开头、各占一行：

```
integrated_multimodal_description: [Shot 1] ...
overall_soundscape: ...
non_diegetic_music: ...
```

- `integrated_multimodal_description`：沿时间线写画面、动作、镜头、说话人、台词和场景内声音。
- `overall_soundscape`：整段视频的环境声、物理动作声、非语言人声。
- `non_diegetic_music`：角色听不到、只有观众能听到的配乐。
- 参考模式不写 `integrated_multimodal_description`，改用 `detailed_description`；
  两个声音字段同名同序，混用字段名视为格式错误。

### 2.3 镜头编号与切镜

- `[Shot 1]` 是起始镜头，不写时间戳。
- 后续镜头连续编号，并在开头写递增、且落在视频时长内的切镜时间：
  `[Shot 2] At 00:03.500, the camera cuts to ...`
- 切镜动词可用 the camera cuts to / the shot cuts to / the shot transitions to / the shot changes to / the shot switches to。
- 时间戳只用于切镜点。不要把它写成逐秒清单（`00:01.0 - ...`、`0-3 秒：...`），那是分镜表，不是提示词。
- 写「一镜到底 / 不要切镜」时就不要出现 `[Shot 2]` 及之后的镜头；两者只能选一个。

### 2.4 运镜

完整运镜 = 类型 + 幅度 + 速度，写成自然英文，例如
`The camera pushes in with small amplitude at slow speed toward ...`；
幅度和速度都是 medium / normal 时省略，只写类型。

常用词表：

| 类别 | 词汇 |
|---|---|
| 焦距 | Zoom In、Zoom Out |
| 前后移动 | Push In、Pull Out |
| 水平转动 | Pan Left、Pan Right |
| 水平平移 | Truck Left、Truck Right |
| 垂直转动 | Tilt Up、Tilt Down |
| 垂直移动 | Pedestal Up、Pedestal Down |
| 环绕与跟随 | Arc Shot、Tracking Shot |
| 静止与抖动 | Static Shot、Shake Slightly、Shake Strongly |
| 特殊视角 | POV、Roll Clockwise、Roll Counterclockwise |

环绕运镜写 `truck left + pan right` 或反过来，不要只写“环绕运镜”。

### 2.5 说话人编号

- 只有真正发声的主体才给 `(S1)`、`(S2)`……按目标视频的实际发声顺序连续分配。
- 沉默的听众、只张嘴不出声的角色不给编号，写 `the eagle stays silent`。
- 主体首次发声时交代稳定身份：类型、年龄、性别、是否在画内，以及音高、音色、语速或口音。
- 一个群体始终齐声发声、没有个体单独说话时，整个群体算一个说话人，共用一个编号：
  `the youth group (S1) chants together, <d>[English] Save the planet!</d>`
- 多个已有编号的说话人临时齐声，用组合编号：`the three youths (S2,S3,S4) respond in unison, <d>[English] Yes!</d>`
- 画外音、旁白、内心独白同样用稳定编号和 `<d>`，并用 off-screen / voice-over 说明声音位置。
  纯画外说话人没有可见嘴部，不写闭嘴描述；画内人物内心独白而嘴不动时，才补“嘴唇保持闭合”。

### 2.6 台词

- 格式：说话人、身份、动作写在 `<d>` 外；`<d>` 内是语言标签 + 用户的原话，不翻译、不改写。
  `The young woman with a quiet, breathy voice (S1) says: <d>[Chinese] 我下一站下车。</d>`
- 语言标签跟随台词本身（`[Chinese]`、`[English]`、`[Japanese]`……），不要一律写 `[Chinese]`。
- 标点只用句意需要的基础标点（`,` `.` `?` `!`）；删掉重复波浪号、emoji、项目符号和装饰性标点；
  陈述句、疑问句、感叹句分别以 `.` `?` `!` 结束。
- 听不清的词写 `[unclear]`，不要猜。
- 台词长度按第 1 节的语速估算对照镜头时长；一个镜头塞不下就拆镜头，不要硬压。
- 绝不用裸引号代替 `<d>` 写对白，裸引号会被 H3 渲染成画面字幕。

### 2.7 跨镜头台词与结尾截断

- 一句台词在切镜前已经说完：新镜头直接开始。
- 同一句台词被切镜分成两段：前段 `<d>` 末尾和后段 `<d>` 开头各写一个 `<scenetrans>`，
  并在新镜头里说明声音连续：
  `[Shot 1] ... continues, <d>[English] Beneath the leaves, it unearthed a secret,<scenetrans></d>`
  `[Shot 2] At 00:04.500, ... The audio seamlessly continues from the previous shot. ... <d>[English] <scenetrans>a glimmering relic.</d>`
- 同一句台词连续跨两次切镜：中间镜头的 `<d>` 同时以 `<scenetrans>` 开头和结尾。
- 台词被视频结束截断：最后一句末尾写 `<cutoff>`，例如 `<d>[English] Keep the oceans<cutoff></d>`。
- 跨镜头的画内演唱、乐器、广播、电视、手机音乐或动作声，用音频连续性表达说明即可，
  `<scenetrans>` 只用于同一句台词或同一行歌词被切镜割开的情况。
- 可用的连续性表达：The audio seamlessly continues from the previous shot. / The audio from the previous shot continues over the transition. / continues seamlessly over the cut, transitioning from [A] to [B].

### 2.8 画面中可见的文字

画面里真实可见的横幅、招牌、标识、字幕、霓虹、UI 文案，用英文双引号括起，原文原语言逐字保留，不翻译：

`A red neon sign reading "营业中" glows above the doorway.`

不要在提示词里“描述”文字的样子代替写出原文；不要新增画面中并不存在的文字。

### 2.9 两段声音

- `overall_soundscape`：一段连贯文字（1–4 句），写环境声、物理动作声、非语言人声。
  不重复台词、演唱和画内音乐。没有环境声写 `N/A`。
- `non_diegetic_music`：1–3 句，写乐器、速度、节奏、动态；不要只写情绪词。
  角色能听到的音乐属于场景事件，写在画面描述里。没有配乐写 `N/A`。
- 完整台词和歌词只写在 `<d>` 里，不在这两段重复。
- 参考音频的复制/参考关系写在实际生效的那一层：环境声与音效写进 `overall_soundscape`，
  观众专属配乐写进 `non_diegetic_music`；同一音频承担两类内容时，两段各写一次。
- 首尾帧模式如果要求无字幕，`No subtitles, no captions, no on-screen text.` 必须是整段提示词的
  最后一行（在 `non_diegetic_music` 之后，前后不加空行以外的东西）；不需要就整行省略。
  参考模式不加这一行，六段之后直接结束（Filmline）。

## 3. 首尾帧模式

三个主体字段见 2.2，正文是一条连续的镜头散文。

- 只有首帧：先建立图片里的风格、主体、构图与场景锚点，再写动作；路径是
  「首帧锚点 → 动作起点 → 连续变化 → 结果或反应」。
- 只有尾帧：`<Picture 1>` 属于最后一个 `[Shot N]`。先反推合理的早期状态，
  再让人物、物体、镜头和场景逐步收敛，视频结束时精确落到尾帧。
- 首帧 + 尾帧：主写首帧到尾帧之间的路径（主体位移、姿态变化、物体操作、构图与光线过渡）。
  **默认单镜头、不加切镜**；只有用户明确要求多镜头时才拆镜。最后一个镜头必须在视频结束时到达尾帧。
- 双图时如果要写“不要切镜”，用一句明确的 no cut 表述，且不要再出现第二个 Shot。

## 4. 全能参考模式（六段式）

### 4.1 结构

顺序固定，每段以段落名 + 冒号开头，不能缺段、不能加段、不能换序：

```
subject_definitions:
summary:
retention_analysis:
detailed_description:
overall_soundscape:
non_diegetic_music:
```

六段正文用英文，只有 `<d>` 内台词/歌词和画面可见文字保留原语言。
参考模式没有 instruction 行，也没有“禁止字幕”行（Filmline）。

### 4.2 引用标签

| 标签 | 表示 |
|---|---|
| `<Subject N>` | 从素材中抽象出来、可在目标视频复用的可见内容（人物、动物、物体、场景、服装、风格、动作、表情） |
| `<Picture N>` | 作为具体帧、关键帧、尾帧、编辑后关键帧或构图锚点的参考图 |
| `<Video N>` | 整段视频层面的关系：剪辑源、续写起点、运镜/切镜/节奏/时序结构 |
| `<Audio N>` | 被复制或参考的音频信号 |

- 只能使用输入里实际存在的标签，不新增编号；一个标签在所有段落里含义不变。
- `<Picture N>` 只在它真的当帧用时单独成条。一张图只提供人物、动物、物体、服装、场景或风格时，
  为那个可见内容建 `<Subject N>`，并在定义里引用图片来源：
  `<Subject 1> is the man in <Picture 1>, with ...`
- `<Video N>` 只做素材来源或结构来源，不代替主体标签。参考视频只提供动作时，
  建一个 `<Subject N>`：外观来自图片、动作来自视频。
- `<Subject N>` 的特征只在 `subject_definitions` 定义一次，在 `detailed_description` 里首次清晰出现时
  描述一次（限于该镜头真实可见的部分），后续镜头沿用标签，不重新定义。
- 角色三视图/多格设定图：整张图只建一个 Subject，指定主面板（例如 full-body front view）
  负责体型与服装，面部特写面板负责身份；其余面板只是设计参考，不能变成额外人物。
  并在描述里写明目标画面里只有这一个角色。
- `<Audio N>` 与目标说话人绑定时沿用该说话人的编号：`<Audio 1> is the voice-timbre reference for <Subject 1> (S1).`
  这里不重新分配编号。只参考音色、节奏、风格时，不要把参考音频里的台词带进目标视频；
  真正复用台词或歌词时，`<d>` 内必须是忠实原文。
- 仅作为 BGM 或完整 soundtrack 里的人声片段出现的台词/歌词，挂在 `<Audio N>` 下，不创造 `(Sx)`；
  由人物、角色、旁白实际发出的声音才给 `(Sx)`。

### 4.3 summary

一个简短英文段落，开头必须是方括号任务类型，再加正文：

```
[reference generation] The target video shows ...
```

可用的任务类型（按素材实际作用选，不因为有视频/音频就自动成立）：

| 类型 | 使用场景 |
|---|---|
| `keyframe completion` | 图片作为首帧、关键帧、尾帧、编辑后关键帧或其他具体帧锚点 |
| `reference generation` | 图片/视频/音频提供人物、场景、风格、动作、运镜、分镜规划等参考，但不当帧、不编辑源视频 |
| `video editing` | 直接修改已有源视频 |
| `video continuation` | 从已有源视频继续、延长、恢复或转接 |
| `audio reuse` | 完整或部分复用同一段音频信号 |
| `audio reference` | 不复制信号，只参考风格、音色、台词内容、音效质感、节拍或连续性 |

多个关系同时成立时用 ` + ` 组合（两边各一个空格），同一类型不重复：
`[video editing + audio reuse]`、`[video continuation + keyframe completion]`。
编辑源视频时，summary 用 `The target video is an edited version of <Video 1>.` 开头。
summary 不引入新标签，只使用前面已定义的标签。

### 4.4 retention_analysis

每个引用标签一行，格式固定，标签与 `subject_definitions` 完全一致且顺序相同；
不写 `(Sx)`，不插入其他散文。

可见内容（`<Subject N>` / `<Picture N>` / `<Video N>`）的标记：

| 标记 | 含义 |
|---|---|
| `fully_preserved` | 既定作用被完整保留 |
| `partially_preserved` | 仍被使用，但已定义的部分特征发生变化或只保留一部分 |
| `attribute_transfer` | 参考特征被迁移到另一个可独立识别的目标载体 |
| `weak_reference` | 只保留宽泛的风格、类别、构图或氛围相似性 |

音频（`<Audio N>`）的标记：

| 标记 | 含义 |
|---|---|
| `fully_copy` | 完整源音频作为目标视频的完整最终音轨 |
| `partially_copy` | 只复制部分时间段或音频层，或复制后又增删替换了其他声音 |
| `reference` | 不复制信号，只参考音色、节奏、风格、台词内容或声音质感 |
| `weak_reference` | 只保留宽泛的类别或氛围相似性 |

行格式：

```
<Subject 1> (appears in [Shot 1], [Shot 3]): fully_preserved - ...
<Picture 2> ([Shot 1] first frame): fully_preserved - ...
<Video 1> (cut and pacing structure): weak_reference - ...
<Audio 1>: reference - ...
```

标记以该标签在 `subject_definitions` 里的作用为判断范围：场景参考被重新构图或调色算
`partially_preserved`，不是 `fully_preserved`；不要把目标视频新加的动作或背景误写成参考损失。

### 4.5 detailed_description

- 先用 1–2 句英文建立全局视觉风格，再开始 `[Shot 1]`；镜头规则同 2.3、运镜同 2.4。
- 逐镜写：当前构图、主体外观与位置、环境与光线、动作与状态变化、相机运动、当下声音，
  以及参考内容实际出现或生效的位置。避免只概括剧情。
- 帧锚点用自然表达：`the shot begins from <Picture 1>`、`the shot's keyframe corresponds to <Picture 2>`、
  `the shot ends on <Picture 3>`。
- 编辑或续写源视频时，在镜头里自然引用 `<Video N>` 的源状态、结构或延续关系；
  音频在某镜头生效时，在该位置引用 `<Audio N>`。
- `<Subject N>` 首次出现时写清参考特征、画面位置和当前动作；每个动作节拍都点名对应标签。
- 主体本人发声写作 `<Subject N> (Sx)`；画外发声沿用同一编号并写 off-screen。
- 生成类内容的 `detailed_description` 通常 350–500 个英文单词；台词密集时以台词时间线为先；
  视频编辑类按源视频复杂度展开。
- 明确写出目标视频里“只有这些主体”，除非用户要求更多。

### 4.6 六段示例（精简）

```
subject_definitions:
<Subject 1> is the woman in <Picture 1>, with long dark hair and a blue cardigan.
<Audio 1> is the voice-timbre reference for <Subject 1> (S1).

summary:
[reference generation + audio reference] The target video shows <Subject 1> answering a call in a quiet café.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - her identity, hair and cardigan are retained.
<Audio 1>: reference - its timbre guides her delivery without copying the signal.

detailed_description:
The target video is in a realistic, soft-lit cinematic style with muted colors.
[Shot 1] A medium close-up frames <Subject 1>, the dark-haired woman in the blue cardigan, seated by a window. She lifts the phone and says with the timbre referenced from <Audio 1>, <d>[English] I'll be there in ten minutes.</d> She lowers the phone and looks out at the rain.

overall_soundscape:
Quiet café room tone, a distant espresso machine, and light rain against the window.

non_diegetic_music:
N/A
```

## 5. 交付前自检

写完逐条对照，能全部回答“是”再提交：

1. `video_mode` 与结构匹配，字段名一个不差、顺序正确；参考模式六段齐全、无第七段。
2. 首尾帧模式：instruction 在第一行、时长两位小数、与面板时长一致；双图默认没有多余切镜。
3. 每个切镜时间递增且不超过时长；没有逐秒清单。
4. 每个 `<d>` 有语言标签；每个说话人只有发声者才有 `(Sx)`；台词长度与镜头时长匹配。
5. 跨镜台词 `<scenetrans>` 成对；结尾截断用 `<cutoff>`；没有裸引号对白。
6. 画面可见文字用双引号保留原文，且确实存在于画面。
7. 标签都来自实际素材，编号不虚构；`retention_analysis` 标签与 `subject_definitions` 一一对应、顺序相同。
8. `summary` 以方括号任务类型开头，多个类型用 ` + ` 连接且不重复。
9. 声音两段没有重复台词；该写 `N/A` 的地方写了 `N/A`。
10. 总长 ≤7000 字符；没有编造参考素材里不存在的外貌、道具、颜色或文字。
