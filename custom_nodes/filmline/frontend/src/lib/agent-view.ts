/** 把 SSE 事件折叠成可渲染的 turn / step / tool 视图。纯函数，便于单测。 */

import type { AgentAssetRef, AgentEvent, AgentQuestion, AgentUsage } from './agent'

export type ToolStatus = 'running' | 'waiting' | 'ok' | 'error' | 'paused'

export interface ToolView {
  id: string
  name: string
  label: string
  argsRaw: string
  status: ToolStatus
  summary?: string
  resultRaw?: string
  progress?: string
  percent?: number | null
  elapsedMs?: number
  write?: boolean
  destructive?: boolean
  cached?: boolean
}

export interface StepView {
  turn: number
  step: number
  reasoning: string
  content: string
  tools: ToolView[]
  done: boolean
  discarded: boolean
}

export interface TurnUser {
  text: string
  assets: AgentAssetRef[]
  content?: string
  notice?: boolean
  noticeSource?: string
}

export interface RetryView {
  attempt: number
  maxAttempts: number
  delayMs: number
  code: string
  message: string
}

export interface TurnView {
  turn: number
  user?: TurnUser
  steps: StepView[]
  errors: string[]
  retries: RetryView[]
  question?: {
    toolCallId: string
    questions: AgentQuestion[]
    answers?: Record<string, unknown>
  }
}

export interface AgentView {
  turns: TurnView[]
  usage: AgentUsage | null
  status: string | null
  lastSeq: number
}

export const emptyView: AgentView = { turns: [], usage: null, status: null, lastSeq: 0 }

function text(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value : ''
}

function number(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]
  return typeof value === 'number' ? value : undefined
}

function ensureTurn(turns: TurnView[], turn: number): TurnView {
  const existing = turns.find((item) => item.turn === turn)
  if (existing) return existing
  const created: TurnView = { turn, steps: [], errors: [], retries: [] }
  turns.push(created)
  turns.sort((a, b) => a.turn - b.turn)
  return created
}

function ensureStep(turn: TurnView, step: number, turnNumber: number): StepView {
  const existing = turn.steps.find((item) => item.step === step)
  if (existing) return existing
  const created: StepView = {
    turn: turnNumber,
    step,
    reasoning: '',
    content: '',
    tools: [],
    done: false,
    discarded: false,
  }
  turn.steps.push(created)
  turn.steps.sort((a, b) => a.step - b.step)
  return created
}

function toolIn(turn: TurnView, toolCallId: string): ToolView | undefined {
  for (const step of turn.steps) {
    const found = step.tools.find((item) => item.id === toolCallId)
    if (found) return found
  }
  return undefined
}

function setTool(step: StepView, tool: ToolView): void {
  const index = step.tools.findIndex((item) => item.id === tool.id)
  if (index >= 0) step.tools[index] = { ...step.tools[index], ...tool }
  else step.tools.push(tool)
}

export function applyEvent(view: AgentView, event: AgentEvent): AgentView {
  if (event.seq <= view.lastSeq) return view
  const turns = view.turns.map((turn) => ({
    ...turn,
    steps: turn.steps.map((step) => ({ ...step, tools: [...step.tools] })),
    retries: [...turn.retries],
  }))
  const data = event.data
  const turnNumber = number(data, 'turn') ?? turns[turns.length - 1]?.turn ?? 0
  let usage = view.usage
  let status = view.status

  switch (event.type) {
    case 'user.message': {
      const turn = ensureTurn(turns, turnNumber)
      turn.user = {
        text: text(data, 'text'),
        assets: Array.isArray(data.assets) ? (data.assets as AgentAssetRef[]) : [],
      }
      break
    }
    case 'notice': {
      const turn = ensureTurn(turns, turnNumber)
      turn.user = {
        text: text(data, 'text'),
        assets: [],
        notice: true,
        noticeSource: text(data, 'source'),
      }
      break
    }
    case 'step.started': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, number(data, 'step') ?? 0, turnNumber)
      // 自动重试会用同一个 step 号重新开始；清掉上一轮的半截内容
      step.reasoning = ''
      step.content = ''
      step.tools = []
      step.done = false
      step.discarded = false
      status = 'running'
      break
    }
    case 'reasoning.delta': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, number(data, 'step') ?? lastStep(turn), turnNumber)
      step.reasoning += text(data, 'text')
      break
    }
    case 'content.delta': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, number(data, 'step') ?? lastStep(turn), turnNumber)
      step.content += text(data, 'text')
      break
    }
    case 'step.finished': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, number(data, 'step') ?? lastStep(turn), turnNumber)
      step.content = text(data, 'content')
      step.reasoning = text(data, 'reasoning')
      step.done = true
      const calls = Array.isArray(data.tool_calls) ? data.tool_calls : []
      for (const call of calls) {
        if (!call || typeof call !== 'object') continue
        const item = call as { id?: unknown; function?: { name?: unknown } }
        const id = typeof item.id === 'string' ? item.id : ''
        if (!id || step.tools.some((tool) => tool.id === id)) continue
        step.tools.push({
          id,
          name: typeof item.function?.name === 'string' ? item.function.name : '',
          label: typeof item.function?.name === 'string' ? item.function.name : '工具',
          argsRaw: '',
          status: 'running',
        })
      }
      break
    }
    case 'step.discarded': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, number(data, 'step') ?? lastStep(turn), turnNumber)
      step.discarded = true
      step.content = ''
      step.reasoning = ''
      step.tools = []
      break
    }
    case 'retry': {
      const turn = ensureTurn(turns, turnNumber)
      turn.retries.push({
        attempt: number(data, 'attempt') ?? 1,
        maxAttempts: number(data, 'max_attempts') ?? 1,
        delayMs: number(data, 'delay_ms') ?? 0,
        code: text(data, 'code'),
        message: text(data, 'message'),
      })
      status = 'running'
      break
    }
    case 'tool.started': {
      const turn = ensureTurn(turns, turnNumber)
      const step = ensureStep(turn, lastStep(turn), turnNumber)
      setTool(step, {
        id: text(data, 'tool_call_id'),
        name: text(data, 'name'),
        label: text(data, 'label') || text(data, 'name'),
        argsRaw: text(data, 'args_raw'),
        status: 'running',
        write: data.write === true,
        destructive: data.destructive === true,
      })
      break
    }
    case 'tool.progress': {
      const turn = ensureTurn(turns, turnNumber)
      const tool = toolIn(turn, text(data, 'tool_call_id'))
      if (tool) {
        tool.progress = text(data, 'text')
        tool.percent = number(data, 'percent') ?? tool.percent
      }
      break
    }
    case 'tool.finished': {
      const turn = ensureTurn(turns, turnNumber)
      const tool = toolIn(turn, text(data, 'tool_call_id'))
      const raw = text(data, 'result_raw')
      if (tool) {
        tool.status = (text(data, 'status') || 'ok') as ToolStatus
        tool.summary = text(data, 'summary')
        tool.resultRaw = raw
        tool.elapsedMs = number(data, 'elapsed_ms')
        tool.cached = data.cached === true
      }
      break
    }
    case 'question': {
      const turn = ensureTurn(turns, turnNumber)
      const questions = Array.isArray(data.questions) ? (data.questions as AgentQuestion[]) : []
      turn.question = { toolCallId: text(data, 'tool_call_id'), questions }
      const tool = toolIn(turn, text(data, 'tool_call_id'))
      if (tool) tool.status = 'waiting'
      status = 'waiting_input'
      break
    }
    case 'question.answered': {
      const turn = turns.find((item) => item.question?.toolCallId === text(data, 'tool_call_id'))
      if (turn?.question) {
        turn.question.answers = (data.answers as Record<string, unknown>) ?? {}
      }
      status = 'running'
      break
    }
    case 'usage': {
      usage = data as AgentUsage
      break
    }
    case 'session.status': {
      const next = text(data, 'status')
      if (next) status = next
      // 进程重启/暂停后，未落库的半截 step 不会再有后续增量，先清掉
      if (next === 'interrupted' || next === 'paused') {
        for (const turn of turns) turn.steps = turn.steps.filter((step) => step.done)
      }
      break
    }
    case 'run.started': {
      const turn = ensureTurn(turns, turnNumber)
      turn.steps = turn.steps.filter((step) => step.done)
      status = 'running'
      break
    }
    case 'run.finished': {
      const next = text(data, 'status')
      status = next === 'paused' ? 'paused' : next === 'error' ? 'error' : 'idle'
      break
    }
    case 'error': {
      const turn = ensureTurn(turns, turnNumber)
      turn.errors.push(text(data, 'message') || '发生错误')
      status = 'error'
      break
    }
    default:
      break
  }

  return { turns, usage, status, lastSeq: event.seq }
}

export function applyEvents(view: AgentView, events: AgentEvent[]): AgentView {
  return events.reduce(applyEvent, view)
}

function lastStep(turn: TurnView): number {
  return turn.steps[turn.steps.length - 1]?.step ?? 0
}

/** 最终回答：最后一个未废弃、且没有工具调用的 step。 */
export function finalStep(turn: TurnView): StepView | undefined {
  for (let index = turn.steps.length - 1; index >= 0; index -= 1) {
    const step = turn.steps[index]
    if (!step || step.discarded) continue
    if (step.tools.length === 0) return step
    return undefined
  }
  return undefined
}

export function intermediateSteps(turn: TurnView): StepView[] {
  const final = finalStep(turn)
  return turn.steps.filter((step) => step !== final && !step.discarded)
}

export function pendingQuestion(view: AgentView): TurnView | undefined {
  return [...view.turns]
    .reverse()
    .find((turn) => turn.question && turn.question.answers === undefined)
}

export function formatTokens(value: number | null | undefined): string {
  if (!value || value <= 0) return '0'
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(Math.round(value))
}

export function contextLabel(usage: AgentUsage | null, fallbackWindow: number): string {
  // 下一轮请求会带上本轮输出，所以用 total_tokens（prompt + completion）更接近真实占用
  const used =
    usage?.total_tokens ??
    (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0)
  const window = usage?.context_window ?? fallbackWindow
  if (!window) return ''
  const percent = Math.min(100, Math.round((used / window) * 100))
  return `${formatTokens(used)}/${formatTokens(window)}（${percent}%）`
}
