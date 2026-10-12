import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULTS, merge } from '../hooks/config'
import { skipReason } from '../hooks/policy'
import { agent, DATA, DAY, HOME, ROOT, world } from './world'

const PROJECT_CONFIG = `${ROOT}/.claude/agent-router.json`
const USER_CONFIG = `${HOME}/.claude/agent-router.json`

describe('explicit routes', () => {
  test('a call with a route line and a model is kept as it is', async ($, on) => {
    const w = world(on)
    const prompt = 'route: opus high — shared layer\n\nRefactor the cache.'
    await $.tool.call(agent({ subagent_type: 'general-purpose', model: 'opus', effort: 'high', prompt }))
    expect(w.core[0]?.prompt).toBe(prompt)
    expect(w.core[0]?.model).toBe('opus')
    expect(w.core[0]?.effort).toBe('high')
    expect(w.toasts).toEqual([])
    expect(w.records()[0]?.mode).toBe('explicit')
  })

  test('a missing effort is filled from the route line', async ($, on) => {
    const w = world(on)
    const prompt = 'route: sonnet medium — tests for clear behaviour\n\nWrite the tests.'
    await $.tool.call(agent({ model: 'sonnet', prompt }))
    expect(w.core[0]?.effort).toBe('medium')
    expect(w.core[0]?.model).toBe('sonnet')
    expect(w.core[0]?.prompt).toBe(prompt)
    expect(w.records()[0]?.mode).toBe('filled')
  })

  test('a missing model is filled from the route line too', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ prompt: 'route: haiku — fixed recipe\n\nRun the script.' }))
    expect(w.core[0]?.model).toBe('haiku')
    expect(w.core[0]?.effort).toBeUndefined()
  })
})

describe('automatic choice with zero setup', () => {
  test('an Agent call with no subagent_type gets a model, an effort and a route line', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'add a settings page', prompt: 'Add a settings page with two toggles.' }))
    expect(w.core[0]?.model).toBe('sonnet')
    expect(w.core[0]?.effort).toBe('medium')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: sonnet medium — auto: code change\nIf you cannot finish this reliably, reply with one line `ESCALATE: <reason>` and stop\.\n\nAdd a settings page/)
    expect(w.toasts.length).toBe(1)
    expect(w.records()[0]).toEqual(expect.objectContaining({ type: 'general-purpose', model: 'sonnet', effort: 'medium', mode: 'auto' }))
  })

  test('general-purpose doing an ordinary code change', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'general-purpose', description: 'fix the date parser', prompt: 'Fix the off-by-one in parseDate and add a test.' }))
    expect(w.core[0]?.model).toBe('sonnet')
    expect(w.core[0]?.effort).toBe('medium')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: sonnet medium — auto: /)
  })

  test('Explore searching goes to the cheap tier without effort', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Explore', description: 'find the config loader', prompt: 'Find where the config is loaded.' }))
    expect(w.core[0]?.model).toBe('haiku')
    expect(w.core[0]?.effort).toBeUndefined()
    expect(String(w.core[0]?.prompt)).toMatch(/^route: haiku — auto: read-only search\nIf you cannot finish/)
  })

  test('Plan gets the ordinary tier, and the risky one on a risky word', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Plan', description: 'plan the export screen', prompt: 'Plan the export screen.' }))
    await $.tool.call(agent({ subagent_type: 'Plan', description: 'plan the payment flow', prompt: 'Plan the payment retry.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
    expect([w.core[1]?.model, w.core[1]?.effort]).toEqual(['opus', 'high'])
    expect(String(w.core[1]?.prompt)).toMatch(/^route: opus high — auto: planning, "payment" → risky/)
  })

  test('a mechanical word in the task title picks the mechanical tier', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'rename the helper', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'low'])
    expect(String(w.core[0]?.prompt)).toMatch(/"rename" → mechanical/)
  })

  test('a Russian mechanical word works the same', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'исправь опечатку', prompt: 'Исправь опечатки в README.' }))
    expect(w.core[0]?.effort).toBe('low')
  })

  test('a risky word anywhere wins over a mechanical title', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'move the auth check', prompt: 'Move the token refresh.\nIt touches the authorization header.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'high'])
  })

  test('a Russian risky word picks the risky tier', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'починить миграцию', prompt: 'Починить миграцию базы.' }))
    expect(w.core[0]?.model).toBe('opus')
  })

  test('a deep word picks the deep tier', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'choose the architecture', prompt: 'Compare two architectures for sync.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'xhigh'])
  })

  test('incidental words do not match inside other words', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ description: 'update the author list', prompt: 'Ask the engineer to update the authors file.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
  })

  test('an unknown type with no definition and no signal abstains and keeps its own model and effort', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'someplugin:helper', prompt: 'Help with the thing we talked about.' }))
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBeUndefined()
    expect(String(w.core[0]?.prompt)).toMatch(/^route: opus — auto: abstain \(unknown type, no signal\)\n\nHelp/)
    expect(w.records()[0]?.mode).toBe('abstain')
  })

  test('an unknown type still gets the middle default when its name says what it does', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'someplugin:docs-writer', prompt: 'Write the API reference page for the projects endpoints.' }))
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBe('medium')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: opus medium — auto: code change, model left to the agent definition/)
  })

  test('a project agent is read for its role and its own model', async ($, on) => {
    const w = world(on, {
      files: {
        [`${ROOT}/.claude/agents/scout.md`]: '---\nname: scout\ndescription: Finds code.\ntools: Read, Grep, Glob\n---\nYou find code.',
        [`${ROOT}/.claude/agents/builder.md`]: '---\nname: builder\ndescription: Builds features.\nmodel: opus\n---\nYou build.',
      },
    })
    await $.tool.call(agent({ subagent_type: 'scout', prompt: 'Find the router.' }))
    await $.tool.call(agent({ subagent_type: 'builder', prompt: 'Build the settings page with two toggles.' }))
    expect(w.core[0]?.model).toBe('haiku')
    expect(w.core[1]?.model).toBeUndefined()
    expect(String(w.core[1]?.prompt)).toMatch(/^route: opus medium — auto: .*agent's own model/)
  })

  test('a plugin agent is found through its plugin folder', async ($, on) => {
    const w = world(on, {
      env: { CLAUDE_CODE_PLUGIN_DIRS: '/Users/tester/plugins/team' },
      files: {
        '/Users/tester/plugins/team/.claude-plugin/plugin.json': '{"name":"team"}',
        '/Users/tester/plugins/team/agents/reviewer.md': '---\nname: reviewer\ndescription: Read-only reviewer of diffs.\ntools: Read, Grep\n---\nReview.',
      },
    })
    await $.tool.call(agent({ subagent_type: 'team:reviewer', prompt: 'Review the diff.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
    expect(String(w.core[0]?.prompt)).toMatch(/auto: review/)
  })

  test('a caller model without a route line is kept and only the effort is filled', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'general-purpose', model: 'opus', prompt: 'Fix the off-by-one bug in parseDate.' }))
    expect(w.core[0]?.model).toBe('opus')
    expect(w.core[0]?.effort).toBe('medium')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: opus medium — auto: code change, model as the caller set it/)
  })
})

describe('the rewrite reaches the PreToolUse layer and core', () => {
  test('a settings PreToolUse hook beneath sees the routed input', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'List the files.' }))
    expect(w.classic[0]?.model).toBe('haiku')
    expect(String(w.classic[0]?.prompt)).toMatch(/^route: haiku — auto:/)
    expect(w.core[0]?.model).toBe('haiku')
  })
})

describe('config', () => {
  test('a project config overrides tiers, types and keywords over the user config', async ($, on) => {
    const w = world(on, {
      files: {
        [USER_CONFIG]: JSON.stringify({ tiers: { ordinary: { model: 'haiku' } } }),
        [PROJECT_CONFIG]: JSON.stringify({
          tiers: { ordinary: { model: 'opus', effort: 'low' } },
          types: { 'acme:*': { model: 'haiku' } },
          keywords: { risky: ['ledger'] },
        }),
      },
    })
    await $.tool.call(agent({ prompt: 'Add a button to the toolbar.' }))
    await $.tool.call(agent({ subagent_type: 'acme:writer', prompt: 'Write.' }))
    await $.tool.call(agent({ description: 'touch the ledger', prompt: 'Touch the ledger.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['opus', 'low'])
    expect(w.core[1]?.model).toBe('haiku')
    expect(String(w.core[1]?.prompt)).toMatch(/config types\.acme:\*/)
    expect(w.core[2]?.effort).toBe('high')
  })

  test('a bad config falls back to the defaults with one warning', async ($, on) => {
    const w = world(on, { files: { [PROJECT_CONFIG]: '{ "max_model": "gpt" }' } })
    await $.tool.call(agent({ prompt: 'Add a button to the toolbar.' }))
    await $.tool.call(agent({ prompt: 'Add a link to the footer.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'medium'])
    const warnings = w.toasts.filter(t => t.includes('invalid'))
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toMatch(/max_model must be one of/)
  })

  test('broken JSON falls back to the defaults with a warning', async ($, on) => {
    const w = world(on, { files: { [PROJECT_CONFIG]: '{ nope' } })
    await $.tool.call(agent({ prompt: 'Add a button to the toolbar.' }))
    expect(w.core[0]?.model).toBe('sonnet')
    expect(w.toasts.some(t => t.includes('invalid'))).toBe(true)
  })

  test('skip leaves the listed types untouched', async ($, on) => {
    const w = world(on, { files: { [PROJECT_CONFIG]: JSON.stringify({ skip: ['team:*'] }) } })
    await $.tool.call(agent({ subagent_type: 'team:engineer', prompt: 'Build it.' }))
    expect(w.core[0]?.prompt).toBe('Build it.')
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.records()[0]?.mode).toBe('untouched')
  })
})

describe('the cap', () => {
  test('a caller model above max_model asks, and "use the cap" lowers it', async ($, on) => {
    const w = world(on, { answer: 'second', files: { [PROJECT_CONFIG]: JSON.stringify({ max_model: 'sonnet' }) } })
    await $.tool.call(agent({ model: 'opus', prompt: 'route: opus high — big refactor\n\nRefactor.' }))
    expect(w.asked.length).toBe(1)
    expect(w.asked[0]).toMatch(/above the cap \(sonnet\)/)
    expect(w.core[0]?.model).toBe('sonnet')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: sonnet high — big refactor/)
  })

  test('above max_model with nobody to ask is denied with a clear message', async ($, on) => {
    const w = world(on, { answer: 'none', files: { [PROJECT_CONFIG]: JSON.stringify({ max_model: 'sonnet' }) } })
    const result = await $.tool.call(agent({ model: 'opus', prompt: 'Refactor.' }))
    expect(w.core.length).toBe(0)
    expect(String(result.deny ?? result.text)).toMatch(/above max_model \(sonnet\)/)
    expect(w.records()[0]?.mode).toBe('denied')
  })

  test('an automatic choice is clamped to max_model without asking', async ($, on) => {
    const w = world(on, { files: { [PROJECT_CONFIG]: JSON.stringify({ max_model: 'sonnet' }) } })
    await $.tool.call(agent({ description: 'fix the race condition', prompt: 'Fix the race condition.' }))
    expect(w.asked.length).toBe(0)
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'high'])
    expect(String(w.core[0]?.prompt)).toMatch(/capped at sonnet/)
  })

  test('fable asks even under the default cap, and runs when allowed', async ($, on) => {
    const w = world(on, { answer: 'first' })
    await $.tool.call(agent({ model: 'fable', prompt: 'route: fable max — engine rewrite\n\nRewrite.' }))
    expect(w.asked[0]).toMatch(/2\.5× the price of opus/)
    expect(w.core[0]?.model).toBe('fable')
  })

  test('fable declined is denied', async ($, on) => {
    const w = world(on, { answer: 'third' })
    const result = await $.tool.call(agent({ prompt: 'route: fable max — engine rewrite\n\nRewrite.' }))
    expect(w.core.length).toBe(0)
    expect(String(result.deny ?? result.text)).toMatch(/declined fable/)
  })
})

describe('calls left alone', () => {
  test('a call with isolation is untouched', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ isolation: 'worktree', prompt: 'Try it.' }))
    expect(w.core[0]?.prompt).toBe('Try it.')
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBeUndefined()
  })

  test('a nested call from a subagent is untouched unless the config says so', () => {
    const call = { subagent_type: 'Explore', prompt: 'Find it.', agentId: 'a1b2' }
    expect(skipReason(call, DEFAULTS)).toBe('nested')
    expect(skipReason(call, merge(DEFAULTS, { nested: true }))).toBeUndefined()
    expect(skipReason({ prompt: 'x' }, DEFAULTS)).toBeUndefined()
  })

  test('an error leaves the input unchanged', async ($, on) => {
    const w = world(on, { storeBroken: true })
    await $.tool.call(agent({ subagent_type: 'someplugin:helper', prompt: 'Help.' }))
    expect(w.core[0]?.prompt).toBe('Help.')
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBeUndefined()
    expect(w.logs.some(l => l.includes('left the call unchanged'))).toBe(true)
  })
})

describe('the record and /route', () => {
  test('/router is a plain command that gives the same answer as /agent-router:route', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find it.' }))
    const plain = await $.command.run({ command: 'router', args: '', origin: { kind: 'composer' } } as never)
    const named = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)
    expect(plain.text).toMatch(new RegExp(`^spawns on ${DAY}:`))
    expect(plain.text).toBe(named.text)
    expect(w.spawns().length).toBe(1)
  })

  test('every spawn is one JSONL line and /route shows the day with its total', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find it.' }))
    await $.tool.call(agent({ model: 'opus', effort: 'high', prompt: 'route: opus high — risky\n\nDo it.' }))
    const rows = w.spawns()
    expect(rows.length).toBe(2)
    expect(rows[0]).toEqual(expect.objectContaining({ at: expect.stringMatching(new RegExp(`^${DAY}T`)), type: 'Explore', model: 'haiku', effort: null, mode: 'auto' }))
    expect(rows[1]).toEqual(expect.objectContaining({ model: 'opus', effort: 'high', mode: 'explicit', reason: 'risky' }))
    const out = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)
    expect(out.text).toMatch(new RegExp(`^spawns on ${DAY}:`))
    expect(out.text).toMatch(/\d\d:\d\d {2}Explore {2}haiku {2}auto/)
    expect(out.text).toMatch(/Total: 2 spawns, 1 routed automatically\. By model: haiku 1, opus 1\./)
    expect(w.files.has(`${DATA}/spawns-${DAY}.jsonl`)).toBe(true)
  })

  test('/route with nothing recorded says so', async ($, on) => {
    world(on)
    const out = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)
    expect(out.text).toBe(`no spawns recorded on ${DAY}.`)
  })
})

describe('languages', () => {
  test('English messages by default', async ($, on) => {
    const w = world(on)
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Find it.' }))
    expect(w.toasts[0]).toBe('Explore → haiku (auto: read-only search)')
  })

  test('Russian messages with language ru', async ($, on) => {
    const w = world(on, { answer: 'none', files: { [PROJECT_CONFIG]: JSON.stringify({ language: 'ru', max_model: 'sonnet' }) } })
    await $.tool.call(agent({ subagent_type: 'Explore', prompt: 'Найди файл.' }))
    const denied = await $.tool.call(agent({ model: 'opus', prompt: 'Сделай.' }))
    const out = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'composer' } } as never)
    expect(w.toasts[0]).toBe('Explore → haiku (авто: поиск без правок)')
    expect(String(w.core[0]?.prompt)).toMatch(/^route: haiku — авто: поиск без правок/)
    expect(String(denied.deny ?? denied.text)).toMatch(/выше max_model \(sonnet\), и подтвердить некому/)
    expect(out.text).toMatch(/Всего: 2, из них автоматически: 1/)
  })
})

describe('what the router learns about agent types', () => {
  test('a plugin type that resolves to its own model is not overridden next time', async ($, on) => {
    const w = world(on)
    on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'agent-1' }))
    await $.agent.spawn({ prompt: 'Run.', subagentType: 'kit:runner', parentModel: 'claude-opus-5-5', fork: false } as never)
    await $.tool.call(agent({ subagent_type: 'kit:runner', prompt: 'Run the recipe.' }))
    expect(w.core[0]?.model).toBeUndefined()
    expect(w.core[0]?.effort).toBeUndefined()
    expect(String(w.core[0]?.prompt)).toMatch(/^route: haiku — auto: abstain \(unknown type, no signal\)/)
  })

  test('a plugin type that inherits the parent model is routed in full next time', async ($, on) => {
    const w = world(on)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'agent-2' }))
    await $.agent.spawn({ prompt: 'Go.', subagentType: 'kit:helper', parentModel: 'claude-opus-5-5', fork: false } as never)
    await $.tool.call(agent({ subagent_type: 'kit:helper', prompt: 'Rename fooBar to loadUser everywhere.' }))
    expect([w.core[0]?.model, w.core[0]?.effort]).toEqual(['sonnet', 'low'])
  })

  test('the offered description of a type sets its role', async ($, on) => {
    const w = world(on)
    on('agent.offer', () => ({ isOffered: true }))
    await $.agent.offer({ agent: 'kit:mapper', description: 'Read-only search across the repository.', source: 'plugin', provider: { plugin: 'kit', tier: 'user' } } as never)
    await $.tool.call(agent({ subagent_type: 'kit:mapper', prompt: 'Map the modules.' }))
    expect(String(w.core[0]?.prompt)).toMatch(/auto: read-only search, model left to the agent definition/)
  })
})

describe('the main loop', () => {
  async function step($: Engine, on: On, text: string) {
    const seen: Record<string, unknown>[] = []
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.step', async function* ($, e) {
      seen.push({ ...e })
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null } as never
    })
    await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
    const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 } as never)
    for await (const chunk of stream as AsyncIterable<unknown>) void chunk
    return seen
  }

  test('is left alone by default', async ($, on) => {
    world(on)
    const seen = await step($, on, 'rename the variable')
    expect([seen[0]?.model, seen[0]?.effort]).toEqual(['claude-opus-5-5', 'high'])
  })

  test('main_loop effort sets the effort of the turn from the prompt', async ($, on) => {
    world(on, { files: { [PROJECT_CONFIG]: JSON.stringify({ main_loop: 'effort' }) } })
    const seen = await step($, on, 'rename the variable')
    expect([seen[0]?.model, seen[0]?.effort]).toEqual(['claude-opus-5-5', 'low'])
  })

  test('main_loop model may lower the model but never raises it', async ($, on) => {
    world(on, { files: { [PROJECT_CONFIG]: JSON.stringify({ main_loop: 'model' }) } })
    const seen = await step($, on, 'rename the variable')
    expect([seen[0]?.model, seen[0]?.effort]).toEqual(['sonnet', 'low'])
  })
})

describe('the /route command', () => {
  test('a run that is not the person typing it passes through to the skill', async ($, on) => {
    world(on)
    on('command.run', () => ({ text: 'skill text' }))
    const out = await $.command.run({ command: 'agent-router:route', args: '', origin: { kind: 'plugin', name: 'other' } } as never)
    expect(out.text).toBe('skill text')
  })
})
