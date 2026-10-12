import { describe, expect, test } from 'claude-code/testing'

import { calibrate } from '../hooks/calibrate'
import { DEFAULTS, merge, validate } from '../hooks/config'
import { pathsIn } from '../hooks/text'
import { agent, done, ROOT, world } from './world'

const PROJECT_CONFIG = `${ROOT}/.claude/agent-router.json`
const config = (value: unknown) => ({ [PROJECT_CONFIG]: JSON.stringify(value) })
const error = (raw: unknown) => {
  const r = validate(raw)
  return 'error' in r ? r.error : undefined
}

const RULES = [
  { name: 'payments code', match: { paths: ['src/payments/**'] }, tier: 'risky' },
  { name: 'big briefs', match: { min_chars: 4000 }, model: 'opus', effort: 'high' },
  { name: 'ledger', match: { regex: '\\bledger\\b' }, tier: 'deep' },
  { name: 'docs bot', match: { type: ['docs:*', 'writer'] }, model: 'haiku' },
  { name: 'legacy', match: { type: 'legacy-*' }, abstain: true },
  { default: true, auto: true },
]

describe('rules', () => {
  test('match by path glob, prompt length, regex and agent type; first match wins', async ($, on) => {
    const w = world(on, { files: config({ rules: RULES }) })
    await $.tool.call(agent({ description: 'tidy up', prompt: 'Tidy up src/payments/refunds/view.ts and its ledger notes.' }))
    await $.tool.call(agent({ description: 'big one', prompt: `Do the work. ${'Context line about the feature. '.repeat(150)}` }))
    await $.tool.call(agent({ description: 'note', prompt: 'Add a ledger export note to the README.' }))
    await $.tool.call(agent({ subagent_type: 'docs:helper', prompt: 'Write the changelog entry for the new export.' }))
    await $.tool.call(agent({ subagent_type: 'legacy-bot', prompt: 'Rename the helper in the old module.' }))
    await $.tool.call(agent({ description: 'rename', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[0]?.prompt)).toMatch(/auto: rule payments code/)
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/rule big briefs/)
    expect([w.core[2]?.model, w.core[2]?.effort]).toEqual(['opus', 'xhigh'])
    expect(w.core[3]?.model).toBe('haiku')
    expect(String(w.core[4]?.prompt)).toMatch(/abstain \(rule legacy\)/)
    expect(w.core[4]?.effort).toBeUndefined()
    expect([w.core[5]?.model, w.core[5]?.effort]).toEqual(['sonnet', 'low'])
  })

  test('the default rule applies when nothing else matches', async ($, on) => {
    const w = world(on, { files: config({ rules: [{ match: { type: 'Explore' }, auto: true }, { default: true, tier: 'ordinary' }] }) })
    await $.tool.call(agent({ description: 'rename', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
    expect(String(w.core[0]?.prompt)).toMatch(/auto: rule default/)
  })

  test('a broken rule list is refused with a reason and the defaults are used', async ($, on) => {
    expect(error({ rules: [{ match: { type: 'x' }, tier: 'risky' }] })).toMatch(/must end with a \{ "default": true/)
    expect(error({ rules: [{ default: true, tier: 'risky' }, { default: true, auto: true }] })).toMatch(/only the last rule/)
    expect(error({ rules: [{ match: {}, tier: 'risky' }, { default: true, auto: true }] })).toMatch(/at least one of/)
    expect(error({ rules: [{ match: { regex: '(' }, tier: 'risky' }, { default: true, auto: true }] })).toMatch(/not a valid regular expression/)
    expect(error({ rules: [{ match: { type: 'x' }, tier: 'risky', model: 'opus' }, { default: true, auto: true }] })).toMatch(/exactly one of/)
    expect(error({ rules: [{ match: { colour: 'x' }, tier: 'risky' }, { default: true, auto: true }] })).toMatch(/unknown field "colour"/)
    expect(error({ rules: RULES })).toBeUndefined()
    const w = world(on, { files: config({ rules: [{ match: { type: 'x' }, tier: 'deep' }] }) })
    await $.tool.call(agent({ description: 'rename', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect(w.core[0]?.effort).toBe('low')
    expect(w.toasts.some(t => t.includes('invalid'))).toBe(true)
  })

  test('paths are read from the brief', () => {
    expect(pathsIn('Edit src/payments/refund.ts and ./README.md, not docs/.')).toEqual(['src/payments/refund.ts', 'README.md', 'docs/'])
  })
})

describe('presets', () => {
  test('thrifty, balanced and strict move the model and effort ceilings together', () => {
    const thrifty = merge(DEFAULTS, { preset: 'thrifty' })
    const strict = merge(DEFAULTS, { preset: 'strict' })
    const balanced = merge(DEFAULTS, { preset: 'balanced' })
    expect([thrifty.max_model, thrifty.max_effort, thrifty.tiers.risky]).toEqual(['sonnet', 'high', { model: 'sonnet', effort: 'high' }])
    expect([strict.max_model, strict.max_effort, strict.tiers.deep]).toEqual(['opus', 'max', { model: 'opus', effort: 'max' }])
    expect(balanced.tiers).toEqual(DEFAULTS.tiers)
    expect(error({ preset: 'cheap' })).toMatch(/preset must be one of thrifty, balanced, strict/)
  })

  test('fields in the same file override the preset', async ($, on) => {
    const w = world(on, { files: config({ preset: 'thrifty', tiers: { risky: { model: 'opus', effort: 'high' } }, max_model: 'opus' }) })
    await $.tool.call(agent({ description: 'fix the race condition', prompt: 'Fix the race condition in the cache.' }))
    await $.tool.call(agent({ description: 'rename', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'high'])
    expect(w.core[1]?.model).toBe('haiku')
  })

  test('max_effort caps the automatic effort and the ladder', async ($, on) => {
    const w = world(on, { files: config({ max_effort: 'medium' }) })
    await $.tool.call(agent({ description: 'fix the race condition', prompt: 'Fix the race condition in the cache.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'medium'])
    expect(String(w.core[0]?.prompt)).toMatch(/effort capped at medium/)
  })
})

describe('the outcome log', () => {
  test('each finished spawn gets an outcome line', async ($, on) => {
    const w = world(on, { replies: [done('Changed it.\nstatus: failed')] })
    await $.tool.call(agent({ description: 'add a page', prompt: 'Add a settings page with two toggles.' }))
    const rows = w.records()
    expect(rows[0]).toEqual(expect.objectContaining({ tier: 'ordinary', chars: 'Add a settings page with two toggles.'.length }))
    expect(rows.find(r => r.kind === 'outcome')).toEqual(expect.objectContaining({ id: rows[0]?.id, outcome: 'check', cause: 'status failed' }))
  })
})

describe('calibrate', () => {
  const spawn = (id: string, description: string, model: string, extra: Record<string, unknown> = {}) => ({ id, type: 'general-purpose', description, model, mode: 'auto', tier: 'ordinary', ...extra })
  const outcome = (id: string, value: string) => ({ kind: 'outcome', id, outcome: value })
  const escalated = (id: string, description: string) => spawn(id, description, 'opus', { mode: 'escalated', escalation: { from: 'sonnet medium', to: 'opus high', cause: 'tests failed' } })

  test('proposes a keyword common to cheap spawns that failed and were escalated', () => {
    const rows = [
      spawn('1', 'reconcile the invoices batch', 'sonnet'), outcome('1', 'check'), escalated('1r', 'reconcile the invoices batch'), outcome('1r', 'ok'),
      spawn('2', 'reconcile the vendor totals', 'sonnet'), outcome('2', 'error'), escalated('2r', 'reconcile the vendor totals'), outcome('2r', 'ok'),
      spawn('3', 'rename the vendor column', 'sonnet'), outcome('3', 'ok'),
    ]
    const c = calibrate(rows)
    expect(c.proposals.find(p => p.kind === 'keyword')).toEqual(expect.objectContaining({ field: 'keywords.risky', value: 'reconcile' }))
    expect(c.proposals.some(p => p.kind === 'keyword' && p.value === 'vendor')).toBe(false)
    expect(c.proposals.some(p => p.kind === 'keyword' && p.value === 'invoices')).toBe(false)
    const target = c.proposals.find(p => p.kind === 'target')
    expect(Number(target?.value)).toBeGreaterThan(c.strong_share)
  })

  test('proposes a lower long_brief when long haiku briefs fail', () => {
    const rows = []
    for (let i = 0; i < 4; i++) rows.push(spawn(`s${i}`, `short lookup ${i}`, 'haiku', { chars: 200 }), outcome(`s${i}`, 'ok'))
    for (let i = 0; i < 4; i++) rows.push(spawn(`l${i}`, `long lookup ${i}`, 'haiku', { chars: 1200 }), outcome(`l${i}`, i < 3 ? 'check' : 'ok'))
    const c = calibrate(rows)
    expect(c.proposals.find(p => p.kind === 'threshold')).toEqual(expect.objectContaining({ field: 'long_brief', value: 1000 }))
  })

  test('flags a high abstain rate and never touches the config', () => {
    const rows = [spawn('a', 'x one', 'opus', { mode: 'abstain' }), spawn('b', 'x two', 'opus', { mode: 'abstain' }), spawn('c', 'x three', 'sonnet')]
    const before = JSON.stringify(DEFAULTS)
    const c = calibrate(rows)
    expect(c.proposals.some(p => p.kind === 'abstain')).toBe(true)
    expect(JSON.stringify(DEFAULTS)).toBe(before)
  })
})
