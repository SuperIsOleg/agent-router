import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { costOf, tokensOf } from '../hooks/cost'
import { agent, launched, world } from './world'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

const usage = { input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 }
const finished = (agentId: string, resolvedModel = 'claude-haiku-4-5') => ({
  result: { status: 'completed', agentId, resolvedModel, usage, content: [{ type: 'text', text: 'Found 3 files.' }] },
})
const route = ($: Engine) =>
  $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)

describe('cost of a token count', () => {
  test('list prices with cache reads at a tenth and writes at 1.25×', () => {
    const t = { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 }
    expect(near(costOf('haiku', t), 1 + 5 + 0.1 + 1.25)).toBe(true)
    expect(near(costOf('opus', t), 4 + 20 + 0.4 + 5)).toBe(true)
    expect(tokensOf({ input_tokens: 0, output_tokens: 0 })).toBeUndefined()
    expect(tokensOf(null)).toBeUndefined()
  })
})

describe('real savings', () => {
  test('a finished spawn logs its tokens, its cost and the cost on the main model', async ($, on) => {
    const w = world(on, { replies: [finished('a1')] })
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find where the config is loaded.' }))
    const rows = w.records()
    expect(rows[0]).toEqual(expect.objectContaining({ mode: 'auto', model: 'haiku', main: 'opus', requested: { model: null, effort: null } }))
    const u = rows.find(r => r.kind === 'usage') as { kind: string; model: string; main: string; cost: number; cost_main: number; source: string; id: string }
    expect(u.kind).toBe('usage')
    expect(u.id).toBe(rows[0]?.id as string)
    expect([u.model, u.main, u.source]).toEqual(['haiku', 'opus', 'agent-result'])
    expect(near(u.cost, (10_000 * 1 + 2_000 * 5 + 100_000 * 0.1) / 1e6)).toBe(true)
    expect(near(u.cost_main, u.cost * 4)).toBe(true)
  })

  test("a background spawn's usage comes from its own turn.complete", async ($, on) => {
    const w = world(on, { replies: [launched('bg-1')] })
    await $.tool.call(agent({ subagent_type: 'general-purpose', description: 'add a page', prompt: 'Add a settings page with two toggles.' }))
    await $.turn.complete({ agentId: 'bg-1', answer: 'Done.', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't', usage: { ...usage, model: 'claude-sonnet-4-6' } } as never)
    const u = w.records().find(r => r.kind === 'usage') as { model: string; source: string; agentId: string } | undefined
    expect(u).toEqual(expect.objectContaining({ model: 'sonnet', source: 'turn.complete', agentId: 'bg-1' }))
  })

  test('/route shows the estimated saving, the share off the main model, escalations and abstains', async ($, on) => {
    world(on, { replies: [finished('a1'), finished('a2', 'claude-opus-5-5')] })
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find where the config is loaded.' }))
    await $.tool.call(agent({ description: 'Fix it', prompt: 'fix it' }))
    const out = await route($)
    expect(out.text).toMatch(/≈\$0\.030 \(≈\$0\.120 on the main model\)/)
    expect(out.text).toMatch(/Kept off the main model: 50%\. Escalation rate: 0%\. Abstain rate: 50%\./)
    expect(out.text).toMatch(/Estimated cost: ≈\$0\.150 against ≈\$0\.240 on the main model — saved ≈\$0\.090 \(38%\)\. Estimate: token counts × list prices, for 2 of 2 spawns with known usage\./)
  })

  test('a broken usage field leaves the call and the record intact', async ($, on) => {
    const w = world(on, { replies: [{ result: { status: 'completed', agentId: 'a', usage: 'nope', content: [{ type: 'text', text: 'ok' }] } }] })
    const result = await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find where the config is loaded.' }))
    expect(w.spawns().length).toBe(1)
    expect(w.records().some(r => r.kind === 'usage')).toBe(false)
    expect(result).toEqual(expect.objectContaining({ result: expect.objectContaining({ status: 'completed' }) }))
  })
})
