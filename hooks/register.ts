import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentTurn, MainTurn, SpawnMemo } from '../types'
import { DEFAULTS, merge, RANK, validate } from './config'
import type { Config, Effort, Model } from './config'
import { addTokens, costOf, money, tokensOf } from './cost'
import type { Tokens } from './cost'
import { classify, outcomeOf, remember, settle } from './escalate'
import { aboveCap, aliasOf, keywordHit, skipReason, parseDefinition, parseRoute, roleFromText, routeLine, typeOf } from './policy'
import type { AgentCall, Definition, Role } from './policy'
import { planSpawn, withRoute } from './route'
import type { Mode, Spawn } from './route'
import { texts } from './messages'

type $ = EngineInterface

const mainTurn = atom({ plugin: 'agent-router', key: 'mainTurn' } as const, null as MainTurn | null)
const recent = atom({ plugin: 'agent-router', key: 'recent' } as const, [] as SpawnMemo[])
const turns = atom({ plugin: 'agent-router', key: 'turns' } as const, {} as Record<string, AgentTurn>)

const BUILT_IN = new Set(['general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup'])

export type SpawnRecord = {
  at: string
  id?: string
  type: string
  model: string
  effort: string | null
  mode: Mode | 'untouched' | 'denied'
  reason: string
  requested?: { model: string | null; effort: string | null }
  main?: string
  tier?: string
  chars?: number
  escalation?: { from: string; to: string | null; cause: string }
  description: string
  nested: boolean
}

export type OutcomeRecord = {
  kind: 'outcome'
  at: string
  id: string
  outcome: string
  cause?: string
}

export type UsageRecord = {
  kind: 'usage'
  at: string
  id: string
  agentId?: string
  model: string
  main: string
  tokens: Tokens
  cost: number
  cost_main: number
  source: 'turn.complete' | 'agent-result'
}

type Paths = { root: string; configDir: string; dataDir: string }

const warned = new Set<string>()
const offered = new Map<string, string>()
let writing: Promise<void> = Promise.resolve()

async function paths($: $): Promise<Paths> {
  const root = await $.session.root()
  const home = (await $.env.get('HOME')) ?? ''
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
  const dataDir = (await $.env.get('CLAUDE_PLUGIN_DATA')) ?? `${configDir}/plugins/data/agent-router`
  return { root, configDir, dataDir }
}

async function readText($: $, path: string): Promise<string | undefined> {
  if (!(await $.fs.exists(path))) return undefined
  const text = await $.fs.read(path)
  return typeof text === 'string' ? text : undefined
}

async function loadConfig($: $, p: Paths): Promise<Config> {
  let config = DEFAULTS
  for (const path of [`${p.configDir}/agent-router.json`, `${p.root}/.claude/agent-router.json`]) {
    let reason: string | undefined
    try {
      const text = await readText($, path)
      if (text === undefined) continue
      const checked = validate(JSON.parse(text))
      if ('layer' in checked) {
        config = merge(config, checked.layer)
        continue
      }
      reason = checked.error
    } catch (err) {
      reason = err instanceof Error ? err.message : String(err)
    }
    const line = texts(config.language).badConfig(path, reason)
    if (!warned.has(line)) {
      warned.add(line)
      $.ui.toast(line)
      $.ui.log(line, { to: 'debug' })
    }
    return DEFAULTS
  }
  return config
}

async function pluginRoots($: $, p: Paths): Promise<string[]> {
  const roots = ((await $.env.get('CLAUDE_CODE_PLUGIN_DIRS')) ?? '').split(':').filter(Boolean)
  try {
    const text = await readText($, `${p.configDir}/plugins/installed_plugins.json`)
    const installed: unknown = text === undefined ? undefined : JSON.parse(text)
    const plugins = (installed as { plugins?: Record<string, { installPath?: string }[]> } | undefined)?.plugins ?? {}
    for (const entries of Object.values(plugins)) for (const entry of entries) if (entry.installPath) roots.push(entry.installPath)
  } catch {
    return roots
  }
  return roots
}

async function findDefinition($: $, p: Paths, type: string): Promise<string | undefined> {
  const [plugin, name] = type.includes(':') ? type.split(':', 2) : [undefined, type]
  if (plugin === undefined) {
    for (const path of [`${p.root}/.claude/agents/${name}.md`, `${p.configDir}/agents/${name}.md`]) {
      const text = await readText($, path)
      if (text !== undefined) return text
    }
    return undefined
  }
  for (const root of await pluginRoots($, p)) {
    const base = root.replace(/^~(?=\/)/, p.configDir.replace(/\/\.claude$/, '')).replace(/\/$/, '')
    const manifest = await readText($, `${base}/.claude-plugin/plugin.json`)
    if (manifest === undefined || (JSON.parse(manifest) as { name?: string }).name !== plugin) continue
    return readText($, `${base}/agents/${name}.md`)
  }
  return undefined
}

async function definitionOf($: $, p: Paths, type: string): Promise<Definition> {
  const fallbackModel = aliasOf(await $.session.model()) ?? 'sonnet'
  const file = await findDefinition($, p, type)
  if (file !== undefined) return { ...parseDefinition(file), fallbackModel }
  if (BUILT_IN.has(type)) return { isModelKnown: true, fallbackModel }
  const learned = (await $.store.get(`model:${type}`)) as { own: Model | null } | undefined
  const description = offered.get(type)
  const role: Role | undefined = description === undefined ? undefined : roleFromText(description)
  return {
    role: role === 'unknown' ? undefined : role,
    ownModel: learned?.own ?? undefined,
    isModelKnown: learned !== undefined,
    fallbackModel,
  }
}

async function record($: $, p: Paths, entry: SpawnRecord | UsageRecord | OutcomeRecord): Promise<void> {
  const day = entry.at.slice(0, 10)
  const path = `${p.dataDir}/spawns-${day}.jsonl`
  const run = writing.then(async () => {
    const before = (await readText($, path)) ?? ''
    await $.fs.write(path, `${before}${JSON.stringify(entry)}\n`)
  })
  writing = run.catch(() => undefined)
  await run
}

async function stamp($: $): Promise<string> {
  const now = new Date(await $.clock.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

async function noteUsage($: $, p: Paths, memo: SpawnMemo, main: Model, tokens: Tokens, source: UsageRecord['source'], model?: string): Promise<void> {
  const ran = aliasOf(model) ?? memo.model
  await record($, p, {
    kind: 'usage',
    at: await stamp($),
    id: memo.id,
    ...(memo.agentId !== undefined ? { agentId: memo.agentId } : {}),
    model: ran,
    main,
    tokens,
    cost: costOf(ran, tokens),
    cost_main: costOf(main, tokens),
    source,
  })
}

export const register: Register = on => {
  on('agent.offer', ($, e, next) => {
    offered.set(e.agent, e.description)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (e.model !== undefined || e.fork || BUILT_IN.has(e.subagentType) || result.deny !== undefined) return result
    const resolved = aliasOf(result.model)
    if (resolved !== undefined) {
      const own = resolved === aliasOf(e.parentModel) ? null : resolved
      await $.store.set(`model:${e.subagentType}`, { own })
    }
    return result
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const call = e as unknown as AgentCall & { isolation?: string; agentId?: string; tool_use_id: string }
    const type = typeOf(call)
    let p: Paths
    let config: Config
    let def: Definition | undefined
    let skipped: string | undefined
    try {
      p = await paths($)
      config = await loadConfig($, p)
      skipped = skipReason(call, config)
      if (skipped === undefined) def = await definitionOf($, p, type)
    } catch (err) {
      $.ui.log(texts('en').failedOpen(err instanceof Error ? err.message : String(err)), { to: 'debug' })
      return next(e)
    }
    const t = texts(config.language)
    const base = {
      type,
      description: call.description ?? '',
      nested: call.agentId !== undefined,
    }
    const fail = (err: unknown) => $.ui.log(t.failedOpen(err instanceof Error ? err.message : String(err)), { to: 'debug' })

    const note = async (entry: Omit<SpawnRecord, 'at' | 'type' | 'description' | 'nested'>) => {
      try {
        await record($, p, { at: await stamp($), ...base, ...entry })
      } catch (err) {
        fail(err)
      }
    }

    if (def === undefined) {
      await note({ model: call.model ?? 'default', effort: call.effort ?? null, mode: 'untouched', reason: skipped ?? 'skipped' })
      return next(e)
    }

    const id = call.tool_use_id
    let spawn: Spawn
    try {
      spawn = planSpawn(call, def, config, t, (await read($, recent)) ?? [], await $.clock.now(), id)
    } catch (err) {
      fail(err)
      return next(e)
    }
    if (spawn.complaint !== undefined) {
      const target = spawn.complaint
      try {
        await update($, recent, list => settle(list ?? [], m => m.id === target, { outcome: 'complaint', cause: t.complaint }))
      } catch (err) {
        fail(err)
      }
    }
    for (const line of spawn.notices) {
      $.ui.toast(line)
      $.ui.log(line, { to: 'debug' })
    }
    let model = spawn.model
    let effort = spawn.effort
    let prompt = spawn.prompt
    const why = spawn.why

    if (aboveCap(model, config.max_model)) {
      const cap = config.max_model
      const shown = model ?? cap
      let answer: string | undefined
      try {
        answer = await $.ui.ask(t.askAbove(type, shown, cap, parseRoute(prompt)?.why ?? why), [
          t.allowAnyway(shown),
          t.useCap(cap),
          t.cancel,
        ])
      } catch {
        answer = undefined
      }
      if (answer === undefined) {
        await note({ id, model: shown, effort: effort ?? null, mode: 'denied', reason: 'above max_model, nobody to ask' })
        return { deny: t.deniedNoOne(shown, cap) }
      }
      if (answer === t.useCap(cap)) {
        model = cap
        const old = parseRoute(prompt)
        prompt = withRoute(prompt, routeLine({ model: cap, effort: effort ?? old?.effort, why: old?.why ?? why }))
      } else if (answer !== t.allowAnyway(shown)) {
        await note({ id, model: shown, effort: effort ?? null, mode: 'denied', reason: 'declined above max_model' })
        return { deny: t.deniedByUser(shown) }
      }
    }

    const rewritten: Record<string, unknown> = { ...e, prompt }
    if (model !== undefined) rewritten.model = model
    if (effort !== undefined && aliasOf(model) !== 'haiku') rewritten.effort = effort
    const finalEffort = (rewritten.effort as Effort | undefined) ?? spawn.routed.effort ?? null
    const shownModel = aliasOf(model) ?? spawn.routed.model
    let main: Model = def.fallbackModel
    try {
      main = aliasOf(await $.session.model()) ?? def.fallbackModel
    } catch {
      main = def.fallbackModel
    }

    await note({
      id,
      model: shownModel,
      effort: finalEffort,
      mode: spawn.mode,
      reason: why,
      requested: { model: call.model ?? null, effort: call.effort ?? null },
      main,
      tier: spawn.decision.kind === 'auto' ? spawn.decision.tier : spawn.decision.kind,
      chars: (call.prompt ?? '').length,
      ...(spawn.escalation ? { escalation: spawn.escalation } : {}),
    })
    if ((spawn.mode === 'auto' || spawn.mode === 'abstain') && spawn.notices.length === 0) {
      try {
        const line = t.toast(type, shownModel, finalEffort ?? undefined, why)
        $.ui.toast(line)
        $.ui.log(`agent-router: ${line}`, { to: 'debug' })
      } catch (err) {
        fail(err)
      }
    }

    const memo: SpawnMemo = { ...spawn.memo, model: shownModel, main }
    if (finalEffort !== null) memo.effort = finalEffort
    else delete memo.effort
    try {
      await update($, recent, list => remember(list ?? [], memo))
    } catch (err) {
      fail(err)
    }

    const result = await next(rewritten as typeof e)
    try {
      const seen = outcomeOf(result)
      await update($, recent, list => settle(list ?? [], m => m.id === id, seen))
      if (seen.outcome !== undefined && seen.outcome !== 'pending')
        await record($, p, { kind: 'outcome', at: await stamp($), id, outcome: seen.outcome, ...(seen.cause !== undefined ? { cause: seen.cause } : {}) })
      if (seen.outcome === 'refusal') {
        const line = t.refused(type, seen.cause ?? 'refusal')
        $.ui.toast(line)
        $.ui.log(line, { to: 'debug' })
      }
      const r = (result as { result?: { status?: string; agentId?: string; usage?: unknown; resolvedModel?: string } }).result
      if (r?.status === 'completed') {
        const agentId = r.agentId
        const known = agentId !== undefined ? ((await read($, turns)) ?? {})[agentId] : undefined
        const tokens = known?.tokens ?? tokensOf(r.usage)
        if (tokens !== undefined)
          await noteUsage($, p, { ...memo, ...(agentId !== undefined ? { agentId } : {}) }, main, tokens, known !== undefined ? 'turn.complete' : 'agent-result', known?.model ?? r.resolvedModel)
        if (agentId !== undefined && known !== undefined)
          await update($, turns, all => {
            const { [agentId]: _drop, ...rest } = all ?? {}
            return rest
          })
      }
    } catch (err) {
      fail(err)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const agentId = e.agentId
    if (agentId !== undefined) {
      try {
        const seen = classify({ text: e.answer, reason: e.reason })
        const memos = (await read($, recent)) ?? []
        const owner = memos.find(m => m.agentId === agentId)
        await update($, recent, list =>
          settle(list ?? [], m => m.agentId === agentId && m.outcome === 'pending', seen),
        )
        if (owner !== undefined && owner.outcome === 'pending')
          await record($, await paths($), { kind: 'outcome', at: await stamp($), id: owner.id, outcome: seen.outcome, ...(seen.cause !== undefined ? { cause: seen.cause } : {}) })
        if (seen.outcome === 'refusal' && owner !== undefined) {
          const config = await loadConfig($, await paths($))
          const line = texts(config.language).refused(owner.type, seen.cause ?? 'refusal')
          $.ui.toast(line)
          $.ui.log(line, { to: 'debug' })
        }
        const tokens = tokensOf(e.usage)
        if (tokens !== undefined) {
          if (owner !== undefined) {
            await noteUsage($, await paths($), owner, owner.main ?? owner.model, tokens, 'turn.complete', e.usage?.model)
          } else {
            await update($, turns, all => {
              const before = (all ?? {})[agentId]
              const entry: AgentTurn = { tokens: addTokens(before?.tokens, tokens) }
              const model = e.usage?.model ?? before?.model
              if (model !== undefined) entry.model = model
              return Object.fromEntries([...Object.entries(all ?? {}).filter(([k]) => k !== agentId), [agentId, entry]].slice(-50))
            })
          }
        }
      } catch (err) {
        $.ui.log(texts('en').failedOpen(err instanceof Error ? err.message : String(err)), { to: 'debug' })
      }
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const config = await loadConfig($, await paths($))
      if (config.main_loop !== 'off' && e.origin.kind !== 'plugin') {
        const hit = keywordHit({ prompt: e.text }, config)
        const previous = await read($, mainTurn)
        await update($, mainTurn, () => ({ tier: hit?.tier ?? 'ordinary', why: hit === undefined ? 'ordinary' : `"${hit.word}"`, shown: previous?.shown ?? '' }))
      }
    } catch (err) {
      $.ui.log(texts('en').failedOpen(err instanceof Error ? err.message : String(err)), { to: 'debug' })
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let step = e
    try {
      if (e.agentId === undefined) {
        const turn = await read($, mainTurn)
        if (turn !== null) {
          const config = await loadConfig($, await paths($))
          if (config.main_loop !== 'off') {
            const choice = config.tiers[turn.tier]
            const current = aliasOf(e.model)
            let model = e.model
            if (config.main_loop === 'model' && current !== undefined) {
              const capped = aboveCap(choice.model, config.max_model) ? config.max_model : choice.model
              if (RANK[capped] < RANK[current]) model = capped
            }
            const effort = aliasOf(model) === 'haiku' ? undefined : (choice.effort ?? e.effort)
            step = { ...e, model, effort }
            const shown = `${aliasOf(model) ?? model} ${effort ?? ''}`.trim()
            if (shown !== turn.shown) {
              await update($, mainTurn, t => (t === null ? t : { ...t, shown }))
              $.ui.toast(texts(config.language).mainLoop(aliasOf(model) ?? model, typeof effort === 'string' ? effort : undefined, turn.why))
            }
          }
        }
      }
    } catch (err) {
      step = e
      $.ui.log(texts('en').failedOpen(err instanceof Error ? err.message : String(err)), { to: 'debug' })
    }
    return yield* next(step)
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    try {
      await $.command.register({ name: 'router', description: 'Show today\'s subagent spawns: model, effort, savings / Показать запуски помощников за сегодня' })
    } catch {
      $.ui.log('agent-router: /router did not register, use /agent-router:route', { to: 'debug' })
    }
    return started
  })

  for (const command of ['router', 'agent-router:route']) {
  on('command.run', { command }, async ($, e, next) => {
    if (!['composer', 'bridge', 'sdk'].includes(e.origin.kind)) return next(e)
    const p = await paths($)
    const config = await loadConfig($, p)
    const t = texts(config.language)
    const day = (await stamp($)).slice(0, 10)
    const text = (await readText($, `${p.dataDir}/spawns-${day}.jsonl`)) ?? ''
    const rows = text
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line) as SpawnRecord | UsageRecord | OutcomeRecord
        } catch {
          return undefined
        }
      })
      .filter((r): r is SpawnRecord | UsageRecord | OutcomeRecord => r !== undefined)
    const spawns = rows.filter((r): r is SpawnRecord => (r as { kind?: string }).kind === undefined)
    const usage = rows.filter((r): r is UsageRecord => (r as { kind?: string }).kind === 'usage')
    if (spawns.length === 0) return { text: t.routeNone(day) }
    const spent = new Map<string, { cost: number; main: number }>()
    for (const u of usage) {
      const before = spent.get(u.id) ?? { cost: 0, main: 0 }
      spent.set(u.id, { cost: before.cost + u.cost, main: before.main + u.cost_main })
    }
    const byModel = new Map<string, number>()
    for (const r of spawns) byModel.set(r.model, (byModel.get(r.model) ?? 0) + 1)
    const lines = spawns.flatMap(r => {
      const c = r.id !== undefined ? spent.get(r.id) : undefined
      const row = `${r.at.slice(11, 16)}  ${r.type}  ${r.model}${r.effort ? ` ${r.effort}` : ''}  ${r.mode}  ${r.reason}${c ? `  ${t.routeCost(money(c.cost), money(c.main))}` : ''}`
      const e = r.escalation
      if (e === undefined) return [row]
      return [row, e.to === null ? t.routeTop(e.from, e.cause) : t.routeEscalated(e.from, e.to, e.cause)]
    })
    const escalations = spawns.filter(r => r.escalation?.to).length
    const total = t.routeTotal(
      spawns.length,
      spawns.filter(r => r.mode === 'auto').length,
      [...byModel].map(([m, n]) => `${m} ${n}`).join(', '),
    )
    const out = [t.routeTitle(day), ...lines, total, ...(escalations > 0 ? [t.routeEscalations(escalations)] : [])]
    const routed = spawns.filter(r => r.mode !== 'untouched' && r.mode !== 'denied')
    const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((100 * n) / of + 1e-9))
    if (routed.length > 0) {
      const off = routed.filter(r => r.main !== undefined && r.model !== r.main).length
      const withMain = routed.filter(r => r.main !== undefined).length
      const abstained = routed.filter(r => r.mode === 'abstain').length
      out.push(t.routeRates(pct(off, withMain), pct(escalations, routed.length), pct(abstained, routed.length)))
    }
    if (spent.size > 0) {
      let cost = 0
      let main = 0
      for (const c of spent.values()) {
        cost += c.cost
        main += c.main
      }
      out.push(t.routeSaved(money(cost), money(main), money(Math.max(0, main - cost)), pct(main - cost, main), spent.size, spawns.length))
    }
    return { text: out.join('\n') }
  })
  }
}
