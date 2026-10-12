import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

export const HOME = '/Users/tester'
export const ROOT = '/Users/tester/project'
export const DATA = `${HOME}/.claude/plugins/data/agent-router`
export const DAY = '1970-01-01'

export type Reply = { result: Record<string, unknown> }

export const done = (text: string): Reply => ({ result: { status: 'completed', agentId: 'a', content: [{ type: 'text', text }] } })

export const launched = (agentId: string): Reply => ({ result: { status: 'async_launched', agentId, description: 'x', prompt: 'x' } })

export type World = {
  clock: MockClock
  files: Map<string, string>
  toasts: string[]
  logs: string[]
  core: Record<string, unknown>[]
  classic: Record<string, unknown>[]
  asked: string[]
  records: () => Record<string, unknown>[]
  spawns: () => Record<string, unknown>[]
}

export type WorldOptions = {
  files?: Record<string, string>
  answer?: 'first' | 'second' | 'third' | 'none'
  sessionModel?: string
  storeBroken?: boolean
  env?: Record<string, string>
  replies?: Reply[]
}

export function world(on: On, options: WorldOptions = {}): World {
  const files = new Map(Object.entries(options.files ?? {}))
  const replies = [...(options.replies ?? [])]
  const w: World = {
    clock: mock.clock(on, { now: 12 * 3600 * 1000 }),
    files,
    toasts: [],
    logs: [],
    core: [],
    classic: [],
    asked: [],
    records: () =>
      (files.get(`${DATA}/spawns-${DAY}.jsonl`) ?? '')
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Record<string, unknown>),
    spawns: () => w.records().filter(r => r.kind === undefined),
  }
  mock.env(on, { HOME, ...(options.env ?? {}) })
  if (options.storeBroken === true) {
    on('store.get', () => {
      throw new Error('store is broken')
    })
  } else {
    mock.store(on)
  }
  on('session.root', () => ({ value: ROOT }))
  on('session.model', () => ({ value: options.sessionModel ?? 'claude-opus-5-5' }))
  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('classic.PreToolUse', ($, e) => {
    const raw = e as unknown as Record<string, unknown>
    w.classic.push({ ...((raw.tool_input as Record<string, unknown> | undefined) ?? raw) })
    return {}
  })
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    const input = e as unknown as { questions: { question: string; options: { label: string }[] }[] }
    const q = input.questions[0]
    w.asked.push(q?.question ?? '')
    const index = { first: 0, second: 1, third: 2, none: -1 }[options.answer ?? 'none']
    if (index < 0 || q === undefined) return { deny: 'no one to ask' }
    return { result: { questions: input.questions, answers: { [q.question]: q.options[index]?.label ?? '' } } } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', { tool: 'Agent' }, ($, e) => {
    w.core.push({ ...e })
    return (replies.shift() ?? done('Done.')) as never
  })
  return w
}

export function agent(input: Record<string, unknown>) {
  return { tool: 'Agent', description: 'do the task', prompt: 'Do the task.', ...input } as never
}
