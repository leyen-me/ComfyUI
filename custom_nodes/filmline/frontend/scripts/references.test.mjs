/**
 * 参考素材列表逻辑单测（纯函数，不依赖 DOM）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  EMPTY_REFERENCES,
  MAX_REFERENCE_AUDIOS,
  MAX_REFERENCE_IMAGES,
  MAX_REFERENCE_VIDEOS,
  addAudio,
  addReference,
  addReferences,
  addVideo,
  audioDurationWarning,
  moveReference,
  referenceDurationWarning,
  removeReference,
  reorderReference,
  soundtrackOrdinal,
  standaloneAudioOrdinal,
  totalReferences,
  totalVideoClipDuration,
  videoClipDuration,
  videoClipWarning,
} from '../src/lib/references.ts'

const img = (id) => ({ assetId: id, src: `/assets/${id}`, name: `图${id}.png`, kind: 'image' })
const video = (id, hasAudio = true) => ({
  assetId: id,
  src: `/assets/${id}`,
  name: `视频${id}.mp4`,
  kind: 'video',
  duration: 5,
  hasAudio,
})
const audio = (id) => ({
  assetId: id,
  src: `/assets/${id}`,
  name: `音频${id}.wav`,
  kind: 'audio',
  duration: 5,
})

// 图片：追加、去重、上限
assert.deepEqual(addReference([], img(1)).list, [img(1)])
assert.equal(addReference([img(1)], img(1)).error, '该图片已在参考列表中')
assert.equal(addReference([], { ...img(1), src: '' }).error, '该图片缺少文件内容')
assert.equal(addReference([], { ...img(1), kind: 'video' }).error, '参考图只接受图片资产')

const fullImages = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, index) => img(index + 1))
assert.equal(
  addReference(fullImages, img(99)).error,
  `参考图最多 ${MAX_REFERENCE_IMAGES} 张`,
)
const batch = addReferences(fullImages.slice(0, 8), [img(1), img(20), img(21)])
assert.deepEqual(batch.list.map((item) => item.assetId), [1, 2, 3, 4, 5, 6, 7, 8, 20])
assert.equal(batch.error, `参考图最多 ${MAX_REFERENCE_IMAGES} 张`)

// 视频 / 音频：默认带音轨、上限、总上限、去重
const withVideo = addVideo(EMPTY_REFERENCES, video(1))
assert.equal(withVideo.list[0].useAudio, true)
assert.equal(withVideo.list[0].duration, 5)

let lists = { ...EMPTY_REFERENCES }
for (let index = 0; index < MAX_REFERENCE_VIDEOS; index += 1) {
  const result = addVideo(lists, video(index + 1))
  assert.equal(result.error, undefined)
  lists = { ...lists, videos: result.list }
}
assert.equal(
  addVideo(lists, video(99)).error,
  `参考视频最多 ${MAX_REFERENCE_VIDEOS} 段`,
)
assert.equal(
  addVideo({ ...EMPTY_REFERENCES, images: [img(9)] }, { ...video(1), assetId: 9 }).error,
  '该素材已在参考列表中',
)

let audioLists = EMPTY_REFERENCES
for (let index = 0; index < MAX_REFERENCE_AUDIOS; index += 1) {
  const result = addAudio(audioLists, audio(index + 10))
  assert.equal(result.error, undefined)
  audioLists = { ...audioLists, audios: result.list }
}
assert.equal(
  addAudio(audioLists, audio(99)).error,
  `参考音频最多 ${MAX_REFERENCE_AUDIOS} 段`,
)

// 合计 12 的限制
const twelve = {
  images: Array.from({ length: 9 }, (_, index) => img(index + 1)),
  videos: [video(20), video(21)],
  audios: [audio(30)],
}
assert.equal(totalReferences(twelve), 12)
assert.equal(addAudio(twelve, audio(31)).error, '参考素材合计最多 12 个')
assert.equal(addReference(twelve.images.slice(0, 6), img(99), 12).error, '参考素材合计最多 12 个')

// 音轨编号：视频原声按视频顺序，独立音频排在全部原声之后
const videos = [
  { ...video(1, true), useAudio: true },
  { ...video(2, false), useAudio: false },
  { ...video(3, true), useAudio: true },
]
assert.equal(soundtrackOrdinal(videos, 0), 1)
assert.equal(soundtrackOrdinal(videos, 1), null)
assert.equal(soundtrackOrdinal(videos, 2), 2)
assert.equal(standaloneAudioOrdinal(videos, [audio(10), audio(11)], 0), 3)
assert.equal(standaloneAudioOrdinal(videos, [audio(10), audio(11)], 1), 4)

// 时长提示
assert.equal(referenceDurationWarning(5), null)
assert.match(referenceDurationWarning(1), /2–15 秒/)
assert.match(referenceDurationWarning(16), /2–15 秒/)
// 独立音频无上限，只要求至少 2 秒
assert.equal(audioDurationWarning(5), null)
assert.equal(audioDurationWarning(30), null)
assert.match(audioDurationWarning(1), /至少需要 2 秒/)

// 参考视频裁剪区间：出点 0 表示到结尾
const trimmed = { ...video(1), duration: 10, trimStart: 2, trimEnd: 8 }
assert.deepEqual(videoClipDuration(trimmed), 6)
assert.equal(videoClipWarning(trimmed), null)
assert.deepEqual(videoClipDuration({ ...video(1), trimStart: 2, trimEnd: 0 }), 3)
assert.match(videoClipWarning({ ...video(1), trimStart: 4.5, trimEnd: 5 }), /2–15 秒/)
assert.equal(
  totalVideoClipDuration([trimmed, { ...video(2), duration: 10, trimStart: 0, trimEnd: 4 }]),
  10,
)

// 删除、移动、拖拽排序
assert.deepEqual(removeReference([img(1), img(2), img(3)], 1), [img(1), img(3)])
assert.deepEqual(moveReference([img(1), img(2), img(3)], 0, 1), [img(2), img(1), img(3)])
assert.deepEqual(moveReference([img(1), img(2), img(3)], 0, -1), [img(1), img(2), img(3)])
assert.deepEqual(reorderReference([img(1), img(2), img(3)], 0, 2), [img(2), img(3), img(1)])
assert.deepEqual(reorderReference([img(1), img(2), img(3)], 2, 0), [img(3), img(1), img(2)])

console.log('参考素材列表逻辑正常')
