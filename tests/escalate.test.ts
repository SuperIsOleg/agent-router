import { describe, expect, test } from 'claude-code/testing'

import { classify, outcomeOf } from '../hooks/escalate'
import type { Engine } from 'claude-code/testing'

import { agent, done, launched, ROOT, world } from './world'

const PROJECT_CONFIG = `${ROOT}/.claude/agent-router.json`
const config = (value: unknown) => ({ [PROJECT_CONFIG]: JSON.stringify(value) })
const crash = launched('c1')
const crashed = ($: Engine, agentId = 'c1') =>
  $.turn.complete({ agentId, answer: 'Agent stopped: reached max turns', reason: 'error', durationMs: 1, isAborted: false, turnId: 't' } as never)
const failed = done('Changed the parser.\n\nstatus: failed\nsummary: two tests still red')
const task = { subagent_type: 'general-purpose', description: 'fix the date parser', prompt: 'Fix the off-by-one in parseDate.' }

describe('what counts as a failure', () => {
  test('an error result, a failed or blocked status and failure phrases near the end', () => {
    expect(classify({ isError: true, text: 'boom' }).outcome).toBe('error')
    expect(classify({ text: 'x', reason: 'error' }).outcome).toBe('error')
    expect(classify({ text: 'did it\n\nstatus: blocked' }).outcome).toBe('check')
    expect(classify({ text: 'Done, but the tests failed.' }).outcome).toBe('check')
    expect(classify({ text: 'Сделал, но тесты не прошли.' }).outcome).toBe('check')
    expect(classify({ text: 'Сборка упала на шаге линтера.' }).outcome).toBe('check')
    expect(classify({ text: 'Исправить не удалось.' }).outcome).toBe('check')
    expect(classify({ text: 'Everything is green.' }).outcome).toBe('ok')
    expect(classify({ text: 'x', reason: 'aborted' }).outcome).toBe('neutral')
  })

  test('the Agent tool result: an error, a finished report, a background launch', () => {
    expect(outcomeOf({ isError: true, text: 'Agent crashed' })).toEqual({ outcome: 'error', cause: 'Agent crashed' })
    expect(outcomeOf({ result: { status: 'completed', agentId: 'a1', content: [{ text: 'Done.\nstatus: failed' }] } })).toEqual({ outcome: 'check', cause: 'status failed', agentId: 'a1' })
    expect(outcomeOf({ result: { status: 'async_launched', agentId: 'a2' } })).toEqual({ outcome: 'pending', agentId: 'a2' })
    expect(outcomeOf({ deny: 'no' })).toEqual({ outcome: 'neutral' })
  })

  test('a quoted log with "failed" in the middle does not count', () => {
    const text = `Before the fix:\n\`\`\`\nFAIL parser.test.ts — 3 tests failed\n\`\`\`\n${'I changed the parser and the date helpers. '.repeat(30)}\nAll checks pass now.`
    expect(classify({ text }).outcome).toBe('ok')
  })
})

describe('escalation', () => {
  test('an error escalates one rung on the next try of the same task', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/^route: opus high — auto: retry after a failure on sonnet medium \(Agent stopped: reached max turns\)\nThe previous attempt on sonnet medium failed: Agent stopped: reached max turns\n\nFix the off-by-one/)
    expect(w.toasts.at(-1)).toBe('agent-router: retrying general-purpose on opus high after a failure on sonnet medium (Agent stopped: reached max turns)')
    expect(w.spawns()[1]).toEqual(expect.objectContaining({ mode: 'escalated', escalation: { from: 'sonnet medium', to: 'opus high', cause: 'Agent stopped: reached max turns' } }))
  })

  test('a failed status escalates after two failed checks by default', async ($, on) => {
    const w = world(on, { replies: [failed, failed] })
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('sonnet')
    expect([w.core[2]?.model, w.core[2]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[2]?.prompt)).toMatch(/status failed/)
  })

  test('escalate.after 1 escalates after one failed check', async ($, on) => {
    const w = world(on, { replies: [failed], files: config({ escalate: { after: 1 } }) })
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('opus')
  })

  test('a quoted failure in the middle of a good report does not escalate', async ($, on) => {
    const text = `Before:\n\`\`\`\nbuild failed: 2 errors\n\`\`\`\n${'Fixed the imports and the parser. '.repeat(30)}\nstatus: ok`
    const w = world(on, { replies: [done(text)], files: config({ escalate: { after: 1 } }) })
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('sonnet')
  })

  test('a different task does not escalate', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent({ subagent_type: 'general-purpose', description: 'add a settings page', prompt: 'Add a settings page with two toggles.' }))
    expect(w.core[1]?.model).toBe('sonnet')
  })

  test('a similar prompt under another description is the same task', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent({ ...task, description: 'retry the parser fix' }))
    expect(w.core[1]?.model).toBe('opus')
  })

  test('nothing escalates after the window', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await w.clock.advance(61 * 60_000)
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('sonnet')
  })

  test('the top rung failing again shows a notice and runs as asked', async ($, on) => {
    const prompt = 'route: opus xhigh — architecture call\n\nPick the sync design.'
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent({ ...task, model: 'opus', effort: 'xhigh', prompt }))
    await crashed($)
    await $.tool.call(agent({ ...task, model: 'opus', effort: 'xhigh', prompt }))
    expect([w.core[1]?.model, w.core[1]?.effort, w.core[1]?.prompt]).toEqual(['opus', 'xhigh', prompt])
    expect(w.toasts.at(-1)).toBe('agent-router: the task failed again on opus xhigh — needs a person (Agent stopped: reached max turns)')
  })

  test('max_model stops the ladder', async ($, on) => {
    const w = world(on, { replies: [crash], files: config({ max_model: 'sonnet' }) })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('sonnet')
    expect(w.toasts.at(-1)).toMatch(/needs a person/)
  })

  test('fable is never reached automatically', async ($, on) => {
    const ladder = [{ model: 'sonnet', effort: 'medium' }, { model: 'opus', effort: 'xhigh' }, { model: 'fable', effort: 'max' }]
    const w = world(on, { replies: [crash], files: config({ max_model: 'fable', escalate: { ladder } }) })
    const prompt = 'route: opus xhigh — deep\n\nDo it.'
    await $.tool.call(agent({ ...task, prompt }))
    await crashed($)
    await $.tool.call(agent({ ...task, prompt }))
    expect(w.core[1]?.model).toBe('opus')
    expect(w.asked.length).toBe(0)
    expect(w.toasts.at(-1)).toMatch(/needs a person/)
  })

  test('escalate.enabled false turns it off', async ($, on) => {
    const w = world(on, { replies: [crash], files: config({ escalate: { enabled: false } }) })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    expect(w.core[1]?.model).toBe('sonnet')
  })

  test('an explicit model already higher than the next rung is kept', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    const prompt = 'route: opus xhigh — second try, harder\n\nFix the off-by-one in parseDate.'
    await $.tool.call(agent({ ...task, model: 'opus', effort: 'xhigh', prompt }))
    expect([w.core[1]?.model, w.core[1]?.effort, w.core[1]?.prompt]).toEqual(['opus', 'xhigh', prompt])
  })

  test('an explicit lower model on a retry is raised, and the notice says why', async ($, on) => {
    const w = world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent({ ...task, model: 'sonnet', effort: 'low', prompt: 'route: sonnet low — quick retry\n\nFix the off-by-one in parseDate.' }))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/^route: opus high — auto: retry after a failure on sonnet medium/)
    expect(w.toasts.at(-1)).toMatch(/raised from sonnet low, which the call asked for$/)
  })

  test('a plain session retrying a general-purpose spawn with no type escalates', async ($, on) => {
    const w = world(on, { replies: [crash] })
    const plain = { description: 'add a settings page', prompt: 'Add a settings page with two toggles and a reset button.' }
    await $.tool.call(agent(plain))
    await crashed($)
    await $.tool.call(agent(plain))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
  })

  test('a read-only brief on haiku escalates to the next rung', async ($, on) => {
    const w = world(on, { replies: [crash] })
    const plain = { description: 'list the files', prompt: 'List the files in the repo and summarise them.' }
    await $.tool.call(agent(plain))
    await crashed($)
    await $.tool.call(agent(plain))
    expect(w.core[0]?.model).toBe('haiku')
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['sonnet', 'medium'])
  })

  test('a background spawn is judged by its own turn.complete', async ($, on) => {
    const launched = { result: { status: 'async_launched', agentId: 'bg-1', description: 'x', prompt: 'x' } }
    const w = world(on, { replies: [launched, launched], files: config({ escalate: { after: 1 } }) })
    await $.tool.call(agent(task))
    await $.tool.call(agent({ ...task, description: 'other', prompt: 'Something else entirely, unrelated to dates.' }))
    expect(w.core[1]?.model).toBe('sonnet')
    await $.turn.complete({ agentId: 'bg-1', answer: 'Tried twice.\nstatus: blocked', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't' } as never)
    await $.tool.call(agent(task))
    expect(w.core[2]?.model).toBe('opus')
  })

  test('/route lists the escalation with its cause', async ($, on) => {
    world(on, { replies: [crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    const out = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)
    expect(out.text).toMatch(/ {4}↑ sonnet medium → opus high \(Agent stopped: reached max turns\)/)
    expect(out.text).toMatch(/Escalations: 1\./)
  })
})

describe('escalation notices in Russian', () => {
  test('the retry and the needs-a-person notices', async ($, on) => {
    const w = world(on, { replies: [crash, crash], files: config({ language: 'ru', max_model: 'opus' }) })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    expect(String(w.core[1]?.prompt)).toMatch(/^route: opus high — авто: повтор после неудачи на sonnet medium \(Agent stopped: reached max turns\)/)
    expect(w.toasts.at(-1)).toBe('agent-router: повторяю general-purpose на opus high после неудачи на sonnet medium (Agent stopped: reached max turns)')
  })

  test('нужен человек on the top rung', async ($, on) => {
    const prompt = 'route: opus xhigh — глубоко\n\nPick the sync design.'
    const w = world(on, { replies: [crash], files: config({ language: 'ru' }) })
    await $.tool.call(agent({ ...task, model: 'opus', effort: 'xhigh', prompt }))
    await crashed($)
    await $.tool.call(agent({ ...task, model: 'opus', effort: 'xhigh', prompt }))
    expect(w.toasts.at(-1)).toBe('agent-router: задача снова не прошла на opus xhigh — нужен человек (Agent stopped: reached max turns)')
  })
})

const reply = (text: string) => done(text)

describe('error types', () => {
  test('outcomes are told apart', () => {
    expect(classify({ isError: true, text: 'Timed out after 600s waiting for staging' }).outcome).toBe('transient')
    expect(classify({ isError: true, text: 'API Error: 529 overloaded' }).outcome).toBe('transient')
    expect(classify({ isError: true, text: 'Context limit reached after reading 212 files' }).outcome).toBe('overflow')
    expect(classify({ text: 'Prompt is too long; output truncated.' }).outcome).toBe('overflow')
    expect(classify({ text: "I can't help with collecting personal data of private people." }).outcome).toBe('refusal')
    expect(classify({ text: 'x', reason: 'refusal' }).outcome).toBe('refusal')
    expect(classify({ text: 'Looked at it.\nESCALATE: the TTL is shared with the price service' })).toEqual({ outcome: 'signal', cause: 'the TTL is shared with the price service' })
    expect(classify({ text: 'Ran make test: 1 failure, expected 21 got 20.' }).outcome).toBe('check')
    expect(classify({ text: 'ImageLoaderTests.testEviction fails: cache is never trimmed.' }).outcome).toBe('check')
    expect(classify({ text: 'The stress test still produces corrupted frames in 3 of 100 runs.' }).outcome).toBe('check')
    expect(classify({ isError: true, text: 'Edit failed: old_string not unique' }).outcome).toBe('error')
  })

  test('a timeout is retried once on the same rung, then escalates', async ($, on) => {
    const timeout = { result: {}, isError: true, text: 'Timed out after 600s.' }
    const w = world(on, { replies: [timeout as never, timeout as never] })
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['sonnet', 'medium'])
    expect(w.toasts.some(t => t.startsWith('agent-router: retrying general-purpose once more on sonnet medium (Timed out'))).toBe(true)
    expect([w.core[2]?.model, w.core[2]?.effort]).toEqual(['opus', 'high'])
  })

  test('a context overflow goes up at once and tells the next agent to read less', async ($, on) => {
    const w = world(on, { replies: [{ result: {}, isError: true, text: 'Context limit reached after 212 files' } as never] })
    const explore = { subagent_type: 'Explore', description: 'summarize services', prompt: 'Read every file in services/ and summarize each.' }
    await $.tool.call(agent(explore))
    await $.tool.call(agent(explore))
    expect(w.core[0]?.model).toBe('haiku')
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['sonnet', 'medium'])
    expect(String(w.core[1]?.prompt)).toMatch(/ran out of context: read less/)
  })

  test('a refusal is neither retried nor escalated, only noticed', async ($, on) => {
    const w = world(on, { replies: [reply("I can't help with bypassing the licence check.")] })
    await $.tool.call(agent(task))
    expect(w.toasts.at(-1)).toMatch(/^agent-router: general-purpose refused the task \(I can't help/)
    await $.tool.call(agent(task))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['sonnet', 'medium'])
    expect(w.toasts.at(-1)).toMatch(/not retrying or escalating; ask the person/)
  })

  test('after an escalation, one more crash on the new rung is retried there first', async ($, on) => {
    const w = world(on, { replies: [crash, crash, crash] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent({ ...task }))
    await $.turn.complete({ agentId: 'c1', answer: 'Agent stopped again', reason: 'error', durationMs: 1, isAborted: false, turnId: 't' } as never)
    await $.tool.call(agent(task))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect([w.core[2]?.model, w.core[2]?.effort]).toEqual(['opus', 'high'])
  })

  test('a task that succeeded after an escalation stays on its rung', async ($, on) => {
    const w = world(on, { replies: [crash, reply('Done, tests pass.')] })
    await $.tool.call(agent(task))
    await crashed($)
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect([w.core[2]?.model, w.core[2]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[2]?.prompt)).toMatch(/kept on opus high/)
  })
})

describe('the ESCALATE protocol', () => {
  test('a cheap-tier route line asks for ESCALATE, a strong one does not', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent(task))
    await $.tool.call(agent({ description: 'fix the race condition', prompt: 'Fix the race condition in the cache.' }))
    expect(String(w.core[0]?.prompt)).toMatch(/^route: sonnet medium — auto: code change\nIf you cannot finish this reliably, reply with one line `ESCALATE: <reason>` and stop\.\n\nFix/)
    expect(String(w.core[1]?.prompt)).not.toMatch(/ESCALATE/)
  })

  test('an ESCALATE reply is a failure that goes up at once with its reason', async ($, on) => {
    const w = world(on, { replies: [reply('ESCALATE: the TTL is also read by the price service')] })
    await $.tool.call(agent(task))
    await $.tool.call(agent(task))
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/The previous attempt on sonnet medium asked to escalate: the TTL is also read by the price service/)
  })

  test('escalate.protocol false leaves the line out', async ($, on) => {
    const w = world(on, { files: config({ escalate: { protocol: false } }) })
    await $.tool.call(agent(task))
    expect(String(w.core[0]?.prompt)).not.toMatch(/ESCALATE/)
  })

  test('in Russian', async ($, on) => {
    const w = world(on, { files: config({ language: 'ru' }) })
    await $.tool.call(agent(task))
    expect(String(w.core[0]?.prompt)).toMatch(/Если не можешь надёжно закончить, ответь одной строкой `ESCALATE: <причина>`/)
  })
})

describe('a user retry', () => {
  test('"still failing" in a new spawn of the same task counts as a failure of the last one', async ($, on) => {
    const w = world(on, { replies: [reply('Persisted the toggle.')] })
    const first = { description: 'Fix dark mode toggle', prompt: 'The dark mode toggle does not stick after restart. Fix it.' }
    await $.tool.call(agent(first))
    await $.tool.call(agent({ ...first, prompt: 'try again, still failing - the toggle resets after I kill the app' }))
    expect(w.core[0]?.model).toBe('sonnet')
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/the person says it still does not work/)
  })

  test('«ещё раз, всё ещё не работает» works the same', async ($, on) => {
    const w = world(on, { replies: [reply('Исправил сравнение.')] })
    const first = { description: 'Починить фильтр дат', prompt: 'Исправь фильтр по датам: последний день не попадает в выборку.' }
    await $.tool.call(agent(first))
    await $.tool.call(agent({ ...first, prompt: 'ещё раз, всё ещё не работает: последний день не попадает' }))
    expect(w.core[1]?.model).toBe('opus')
  })

  test('a retry phrase on an unrelated task does nothing', async ($, on) => {
    const w = world(on, { replies: [reply('Done.')] })
    await $.tool.call(agent(task))
    await $.tool.call(agent({ subagent_type: 'general-purpose', description: 'add a settings page', prompt: 'Add the settings page again, with two toggles.' }))
    expect(w.core[1]?.model).toBe('sonnet')
  })
})
