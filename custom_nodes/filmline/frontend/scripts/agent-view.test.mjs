/**
 * Agent 事件折叠与上下文显示的单测（纯函数）。
 *
 *   npm run test:logic
 */
import assert from 'node:assert/strict'
import {
  applyEvent,
  contextLabel,
  emptyView,
  finalStep,
  intermediateSteps,
  pendingQuestion,
} from '../src/lib/agent-view.ts'

function event(seq, type, data) {
  return { seq, type, data }
}

function run(events) {
  return events.reduce(applyEvent, emptyView)
}

const finalOnly = run([
  event(1, 'user.message', { turn: 1, text: '你好', assets: [] }),
  event(2, 'run.started', { turn: 1 }),
  event(3, 'step.started', { turn: 1, step: 0 }),
  event(4, 'reasoning.delta', { text: '思考\n第二行' }),
  event(5, 'content.delta', { text: '最终' }),
  event(6, 'content.delta', { text: '回答' }),
  event(7, 'step.finished', {
    turn: 1,
    step: 0,
    content: '最终回答',
    reasoning: '思考\n第二行',
    tool_calls: [],
  }),
])
assert.equal(finalOnly.turns.length, 1)
assert.equal(finalStep(finalOnly.turns[0])?.content, '最终回答')
assert.equal(finalStep(finalOnly.turns[0])?.reasoning, '思考\n第二行')
assert.equal(intermediateSteps(finalOnly.turns[0]).length, 0)

const withTool = run([
  event(1, 'user.message', { turn: 1, text: '看图', assets: [] }),
  event(2, 'step.started', { turn: 1, step: 0 }),
  event(3, 'content.delta', { text: '先读图' }),
  event(4, 'step.finished', {
    turn: 1,
    step: 0,
    content: '先读图',
    reasoning: '需要图',
    tool_calls: [{ id: 'c1', function: { name: 'read_image', arguments: '{"asset_id":1}' } }],
  }),
  event(5, 'tool.started', {
    turn: 1,
    tool_call_id: 'c1',
    name: 'read_image',
    label: '查看图片',
    args_raw: '{"asset_id":1}',
  }),
  event(6, 'tool.progress', { tool_call_id: 'c1', text: '读取中', percent: 50 }),
  event(7, 'tool.finished', {
    turn: 1,
    tool_call_id: 'c1',
    status: 'ok',
    result_raw: '{"ok":true}',
  }),
  event(8, 'step.started', { turn: 1, step: 1 }),
  event(9, 'step.finished', {
    turn: 1,
    step: 1,
    content: '看完了',
    reasoning: '',
    tool_calls: [],
  }),
])
const toolTurn = withTool.turns[0]
assert.equal(finalStep(toolTurn)?.content, '看完了')
const middle = intermediateSteps(toolTurn)
assert.equal(middle.length, 1)
assert.equal(middle[0].tools.length, 1)
assert.equal(middle[0].tools[0].status, 'ok')
assert.equal(middle[0].tools[0].label, '查看图片')
assert.equal(middle[0].tools[0].percent, 50)

const discarded = run([
  event(1, 'step.started', { turn: 1, step: 0 }),
  event(2, 'content.delta', { text: '半截' }),
  event(3, 'step.discarded', { turn: 1, step: 0 }),
])
assert.equal(discarded.turns[0].steps[0].content, '')
assert.equal(finalStep(discarded.turns[0]), undefined)

const deduped = run([
  event(1, 'content.delta', { text: 'A' }),
  event(1, 'content.delta', { text: '重复' }),
])
assert.equal(deduped.lastSeq, 1)
assert.equal(deduped.turns[0].steps[0].content, 'A')

const resumed = run([
  event(1, 'step.started', { turn: 1, step: 0 }),
  event(2, 'step.finished', {
    turn: 1,
    step: 0,
    content: '第一步',
    reasoning: '',
    tool_calls: [{ id: 'c1', function: { name: 'read_video', arguments: '{}' } }],
  }),
  event(3, 'tool.started', {
    turn: 1,
    tool_call_id: 'c1',
    name: 'read_video',
    label: '查看视频',
    args_raw: '{}',
  }),
  event(4, 'tool.finished', { turn: 1, tool_call_id: 'c1', status: 'ok', result_raw: '{}' }),
  event(5, 'step.started', { turn: 1, step: 1 }),
  event(6, 'reasoning.delta', { text: '半截思考' }),
  event(7, 'session.status', { status: 'interrupted' }),
  event(8, 'run.started', { turn: 1 }),
  event(9, 'step.started', { turn: 1, step: 2 }),
  event(10, 'step.finished', {
    turn: 1,
    step: 2,
    content: '恢复后的回答',
    reasoning: '',
    tool_calls: [],
  }),
])
assert.equal(resumed.turns[0].steps.length, 2)
assert.equal(resumed.turns[0].steps[0].step, 0)
assert.equal(resumed.turns[0].steps[1].step, 2)
assert.equal(resumed.turns[0].steps.some((step) => step.content === '半截思考'), false)
assert.equal(finalStep(resumed.turns[0])?.content, '恢复后的回答')

const retried = run([
  event(1, 'run.started', { turn: 1 }),
  event(2, 'step.started', { turn: 1, step: 0 }),
  event(3, 'content.delta', { text: '半截' }),
  event(4, 'step.discarded', { turn: 1, step: 0, reason: 'retry' }),
  event(5, 'retry', {
    turn: 1,
    step: 0,
    attempt: 1,
    max_attempts: 3,
    delay_ms: 2000,
    code: 'upstream',
    message: '模型服务暂时不可用',
  }),
  event(6, 'step.started', { turn: 1, step: 0 }),
  event(7, 'content.delta', { text: '重试成功' }),
  event(8, 'step.finished', {
    turn: 1,
    step: 0,
    content: '重试成功',
    reasoning: '',
    tool_calls: [],
  }),
])
assert.equal(finalStep(retried.turns[0])?.content, '重试成功')
assert.equal(retried.turns[0].retries.length, 1)
assert.equal(retried.turns[0].retries[0].attempt, 1)
assert.equal(retried.turns[0].steps[0].content, '重试成功')
assert.equal(retried.turns[0].steps[0].discarded, false)

const question = run([
  event(1, 'question', {
    tool_call_id: 'q1',
    turn: 1,
    questions: [
      { id: 'a', header: '确认', question: '继续？', options: [{ label: '是' }] },
    ],
  }),
])
assert.equal(pendingQuestion(question)?.question?.toolCallId, 'q1')

assert.equal(contextLabel({ total_tokens: 32_300, context_window: 1_000_000 }, 0), '32.3K/1M（3%）')
assert.equal(contextLabel(null, 1_000_000), '0/1M（0%）')

console.log('Agent 事件折叠与上下文显示正常')
