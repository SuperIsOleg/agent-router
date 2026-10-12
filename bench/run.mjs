#!/usr/bin/env node
// Offline benchmark for agent-router: runs the router's pure policy over the frozen
// tasks and retry chains. No network, no Claude. Usage:
//   node bench/run.mjs --label <name> [--preset thrifty|balanced|strict] [--config file.json] [--quiet] [--show dev|all|none] [--log out.jsonl]
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL)
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context)
    }
    return next(specifier, context)
  },
})

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOKS = resolvePath(HERE, '../hooks')
const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const label = opt('label') ?? 'run'
const preset = opt('preset')
const configFile = opt('config')
const quiet = args.includes('--quiet')
const show = opt('show') ?? 'dev'
const logFile = opt('log')
const LOG = []
let clockTick = 0
const stampOf = () => {
  const d = new Date(Date.UTC(2026, 0, 1, 9, 0, 0) + clockTick++ * 60_000)
  return d.toISOString().slice(0, 19)
}
const KIND = { ok: 'ok', failed_check: 'check', error: 'error', timeout: 'transient', context_overflow: 'overflow', refusal: 'refusal', escalate_signal: 'signal' }
function logSpawn(id, call, r, extra = {}) {
  if (logFile === undefined) return
  const type = call.subagent_type || 'general-purpose'
  LOG.push({ at: stampOf(), id, type, model: r.model, effort: r.effort ?? null, mode: r.abstain ? 'abstain' : 'auto', reason: r.why, main: SESSION_MODEL, tier: extra.tier ?? null, chars: (call.prompt ?? '').length, description: call.description ?? '', nested: false, ...extra.record })
  const tokens = Math.max(50, Math.ceil((call.prompt ?? '').length / 4))
  const u = { input: tokens * IN_MULT, output: tokens * OUT_MULT, cache_read: 0, cache_write: 0 }
  const price = m => (u.input * PRICE[m][0] + u.output * PRICE[m][1]) / 1e6
  LOG.push({ kind: 'usage', at: stampOf(), id, model: r.model, main: SESSION_MODEL, tokens: u, cost: price(r.model), cost_main: price(SESSION_MODEL), source: 'agent-result' })
}
const logOutcome = (id, outcome) => logFile !== undefined && LOG.push({ kind: 'outcome', at: stampOf(), id, outcome })

// ---------- frozen inputs ----------
function checkFrozen() {
  const sums = readFileSync(join(HERE, 'FROZEN.sha256'), 'utf8').trim().split('\n')
  for (const line of sums) {
    const [sum, file] = line.trim().split(/\s+/)
    const actual = createHash('sha256').update(readFileSync(join(HERE, file))).digest('hex')
    if (actual !== sum) {
      console.error(`bench: ${file} does not match FROZEN.sha256 — the benchmark was changed. Refusing to run.`)
      process.exit(2)
    }
  }
}
checkFrozen()
const TASKS = JSON.parse(readFileSync(join(HERE, 'tasks.json'), 'utf8')).tasks
const CHAINS = JSON.parse(readFileSync(join(HERE, 'chains.json'), 'utf8')).chains

// ---------- router modules ----------
const policy = await import(pathToFileURL(join(HOOKS, 'policy.ts')).href)
const config = await import(pathToFileURL(join(HOOKS, 'config.ts')).href)
const escalate = await import(pathToFileURL(join(HOOKS, 'escalate.ts')).href)
const messages = await import(pathToFileURL(join(HOOKS, 'messages.ts')).href)
const routeModule = existsSync(join(HOOKS, 'route.ts')) ? await import(pathToFileURL(join(HOOKS, 'route.ts')).href) : undefined
const version = JSON.parse(readFileSync(resolvePath(HERE, '../.claude-plugin/plugin.json'), 'utf8')).version

let layer = {}
if (configFile !== undefined) layer = JSON.parse(readFileSync(configFile, 'utf8'))
if (preset !== undefined) layer = { ...layer, preset }
let CONFIG = config.DEFAULTS
if (Object.keys(layer).length > 0) {
  const checked = config.validate(layer)
  if (!('layer' in checked)) {
    console.error(`bench: config rejected: ${checked.error}`)
    process.exit(2)
  }
  CONFIG = config.merge(config.DEFAULTS, checked.layer)
}
const LABELS = messages.texts('en').labels

// ---------- assumptions (documented in bench/README.md) ----------
const SESSION_MODEL = 'opus'
const SESSION_EFFORT = 'high'
const BUILT_IN = new Set(['general-purpose', 'Explore', 'Plan', 'claude-code-guide', 'statusline-setup'])
const PRICE = { haiku: [1, 5], sonnet: [2, 10], opus: [4, 20], fable: [10, 50] }
const IN_MULT = 40
const OUT_MULT = 4
const EFFORT_OUT = { low: 0.6, medium: 1, high: 1.4, xhigh: 1.8, max: 2.2 }
const TIER_RANK = { mechanical: 1, ordinary: 2, risky: 3, deep: 4 }
const EFFORT_RANK = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

function definitionFor(type) {
  if (type === '' || BUILT_IN.has(type)) return { isModelKnown: true, fallbackModel: SESSION_MODEL }
  return { isModelKnown: false, fallbackModel: SESSION_MODEL }
}

function tiersOf(model, effort) {
  const e = effort ?? SESSION_EFFORT
  if (model === 'haiku') return ['mechanical']
  if (model === 'sonnet') return e === 'low' ? ['mechanical'] : e === 'medium' ? ['mechanical', 'ordinary'] : ['ordinary']
  if (model === 'opus') return e === 'low' || e === 'medium' ? ['ordinary'] : e === 'high' ? ['risky'] : ['deep']
  return ['deep']
}

function estCost(prompt, model, effort) {
  const tokens = Math.max(50, Math.ceil(prompt.length / 4))
  const [pin, pout] = PRICE[model] ?? PRICE.opus
  const factor = model === 'haiku' ? 1 : EFFORT_OUT[effort ?? SESSION_EFFORT] ?? 1
  return (tokens * IN_MULT * pin + tokens * OUT_MULT * factor * pout) / 1e6
}

const split = id => (parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'dev' : 'holdout')

// ---------- one spawn through the router ----------
const withRoute = (prompt, line) => (policy.ROUTE_LINE.test(prompt) ? prompt.replace(policy.ROUTE_LINE, line) : `${line}\n\n${prompt}`)
const show1 = c => (c.effort !== undefined && c.model !== 'haiku' ? `${c.model} ${c.effort}` : c.model)

function spawnLegacy(call, memos, now) {
  const type = call.subagent_type ?? 'general-purpose'
  const def = definitionFor(type)
  const decision = policy.decide(call, def, CONFIG, LABELS)
  let model = decision.kind === 'keep' ? call.model : (decision.model ?? call.model)
  let effort = call.effort
  if (effort === undefined && decision.kind !== 'keep') effort = decision.effort
  if (effort === undefined && decision.kind === 'keep') effort = policy.parseRoute(call.prompt)?.effort
  let prompt = call.prompt ?? ''
  if (decision.kind === 'auto') prompt = withRoute(prompt, policy.routeLine(decision.route))
  const desc = escalate.normalize(call.description ?? '')
  const fp = escalate.fingerprint(call.prompt ?? '')
  const routedModel = () => policy.aliasOf(model) ?? (decision.kind === 'auto' ? decision.route.model : (policy.parseRoute(prompt)?.model ?? 'sonnet'))
  const step = escalate.plan(memos, { type, desc, fp }, now, CONFIG.escalate, CONFIG.max_model)
  let notice
  const current = { model: routedModel(), effort }
  if (step.kind === 'escalate' && escalate.above(step.to, current)) {
    model = step.to.model
    effort = step.to.effort
    prompt = withRoute(prompt, policy.routeLine({ model: step.to.model, effort, why: `auto: retry after a failure on ${show1(step.from)} (${step.cause})` }))
    notice = 'escalate'
  } else if (step.kind === 'top') notice = 'needs-person'
  const resolvedModel = policy.aliasOf(model) ?? def.fallbackModel
  const resolvedEffort = resolvedModel === 'haiku' ? undefined : effort
  const memo = { id: `t${now}`, type, desc, fp, model: routedModel(), outcome: 'pending', at: now }
  if (resolvedEffort !== undefined) memo.effort = resolvedEffort
  return {
    model: resolvedModel,
    effort: resolvedEffort,
    abstain: false,
    prompt,
    notice,
    why: decision.why,
    memos: escalate.remember(memos, memo),
    settle: (list, result) => escalate.settle(list, m => m.id === memo.id, escalate.outcomeOf(result)),
  }
}

function spawn(call, memos, now) {
  if (routeModule?.benchSpawn === undefined) return spawnLegacy(call, memos, now)
  const type = call.subagent_type === undefined || call.subagent_type === '' ? 'general-purpose' : call.subagent_type
  return routeModule.benchSpawn(call, definitionFor(type), CONFIG, LABELS, memos, now)
}

// ---------- tasks ----------
function runTasks() {
  const rows = []
  for (const t of TASKS) {
    const call = { subagent_type: t.subagent_type, description: t.description, prompt: t.prompt }
    const r = spawn(call, [], 1_000_000)
    const set = r.abstain ? [] : tiersOf(r.model, r.effort)
    const acceptable = t.acceptable_tiers
    const maxAcc = Math.max(...acceptable.map(x => TIER_RANK[x]))
    const top = set.length > 0 ? Math.max(...set.map(x => TIER_RANK[x])) : 0
    const low = set.length > 0 ? Math.min(...set.map(x => TIER_RANK[x])) : 0
    const row = {
      id: t.id,
      split: split(t.id),
      lang: t.lang,
      tags: t.tags,
      ambiguous: t.ambiguous,
      expected: t.expected_tier,
      acceptable,
      min_safe: t.min_safe_tier,
      model: r.model,
      effort: r.effort ?? null,
      abstain: r.abstain,
      tier: r.abstain ? 'abstain' : set.at(-1),
      why: r.why,
      exact: !r.abstain && set.includes(t.expected_tier),
      within: !r.abstain && set.some(x => acceptable.includes(x)),
      under: !r.abstain && top < TIER_RANK[t.min_safe_tier],
      over: !r.abstain && low > maxAcc,
      cost: estCost(t.prompt, r.model, r.effort),
      cost_opus: estCost(t.prompt, 'opus', SESSION_EFFORT),
    }
    row.correct = row.within || (r.abstain && t.ambiguous)
    rows.push(row)
    logSpawn(`task-${t.id}`, call, r, { tier: row.tier })
    if (row.under) {
      logOutcome(`task-${t.id}`, 'check')
      const up = { model: 'opus', effort: 'high', abstain: false, why: 'auto: retry after a failure' }
      logSpawn(`task-${t.id}-retry`, call, up, { tier: 'risky', record: { mode: 'escalated', escalation: { from: `${r.model}${r.effort ? ` ${r.effort}` : ''}`, to: 'opus high', cause: 'tests failed' } } })
      logOutcome(`task-${t.id}-retry`, 'ok')
    } else logOutcome(`task-${t.id}`, 'ok')
  }
  return rows
}

function summarize(rows) {
  const n = rows.length
  const count = f => rows.filter(f).length
  const pct = x => (n === 0 ? 0 : Math.round((1000 * x) / n) / 10)
  const amb = rows.filter(r => r.ambiguous)
  const cost = rows.reduce((s, r) => s + r.cost, 0)
  const opus = rows.reduce((s, r) => s + r.cost_opus, 0)
  const traps = {}
  for (const r of rows)
    for (const tag of r.tags.filter(x => x.startsWith('trap:'))) {
      traps[tag] ??= { n: 0, correct: 0, under: 0, over: 0, abstain: 0 }
      traps[tag].n++
      if (r.correct) traps[tag].correct++
      if (r.under) traps[tag].under++
      if (r.over) traps[tag].over++
      if (r.abstain) traps[tag].abstain++
    }
  const byModel = {}
  for (const r of rows) {
    const k = r.abstain ? 'abstain' : `${r.model}${r.effort ? ` ${r.effort}` : ''}`
    byModel[k] = (byModel[k] ?? 0) + 1
  }
  return {
    n,
    under: count(r => r.under),
    under_pct: pct(count(r => r.under)),
    exact: count(r => r.exact),
    exact_pct: pct(count(r => r.exact)),
    within: count(r => r.within),
    within_pct: pct(count(r => r.within)),
    correct: count(r => r.correct),
    correct_pct: pct(count(r => r.correct)),
    over: count(r => r.over),
    over_pct: pct(count(r => r.over)),
    abstain: count(r => r.abstain),
    abstain_pct: pct(count(r => r.abstain)),
    ambiguous: amb.length,
    abstain_on_ambiguous: amb.filter(r => r.abstain).length,
    cost_usd: Math.round(cost * 1e4) / 1e4,
    cost_all_opus_usd: Math.round(opus * 1e4) / 1e4,
    cost_vs_opus_pct: opus === 0 ? 0 : Math.round((1000 * cost) / opus) / 10,
    traps,
    by_model: byModel,
  }
}

// ---------- chains ----------
// Each chain's free-text `expected` is read as decision points. "After step k" is judged on the next
// spawn of the same task (step k+1 when it repeats step k and is not described by its own
// "Step k+1" line), otherwise on a virtual exact repeat of step k. "Step k is …" is judged on spawn k.
const CHAIN_POINTS = {
  'ch-01-failed-check-twice': [[1, 'after', ['retry-same']], [2, 'after', ['escalate']], [3, 'after', ['no-change']]],
  'ch-02-error-once': [[1, 'after', ['escalate']], [2, 'after', ['no-change']]],
  'ch-03-context-overflow': [[1, 'after', ['escalate']], [2, 'after', ['no-change']]],
  'ch-04-refusal': [[1, 'after', ['stop']]],
  'ch-05-timeout-then-escalate': [[1, 'after', ['retry-same']], [2, 'after', ['escalate']], [3, 'after', ['no-change']]],
  'ch-06-escalate-signal': [[1, 'after', ['escalate'], 'reason'], [2, 'after', ['no-change']]],
  'ch-07-user-retry-ru': [[1, 'after', ['no-change']], [2, 'step', ['escalate']], [3, 'step', ['escalate', 'same-rung']], [3, 'after', ['no-change']]],
  'ch-08-user-retry-en': [[1, 'after', ['no-change']], [2, 'step', ['escalate']]],
  'ch-09-different-task': [[1, 'after', ['retry-same']], [2, 'step', ['no-change']], [3, 'step', ['no-change']]],
  'ch-10-success': [[1, 'after', ['no-change']]],
  'ch-11-top-of-ladder': [[1, 'after', ['retry-same']], [2, 'after', ['needs-person']], [3, 'after', ['needs-person']]],
  'ch-12-fail-then-ok': [[1, 'after', ['retry-same']], [2, 'after', ['no-change']]],
  'ch-13-error-then-failed-check': [[1, 'after', ['escalate']], [2, 'after', ['retry-same']], [3, 'after', ['escalate']], [4, 'after', ['no-change']]],
  'ch-14-refusal-then-new-task': [[1, 'after', ['stop']], [2, 'step', ['no-change']]],
  'ch-15-timeout-twice-then-escalate-chain': [[1, 'after', ['retry-same']], [2, 'after', ['escalate']], [3, 'after', ['escalate'], 'reason'], [4, 'after', ['needs-person']]],
}

const FAILED = new Set(['failed_check', 'error', 'timeout', 'context_overflow', 'refusal', 'escalate_signal'])

function resultOf(outcome, agentId) {
  if (['error', 'timeout', 'context_overflow'].includes(outcome.kind)) return { isError: true, text: outcome.text }
  return { result: { status: 'completed', agentId, content: [{ type: 'text', text: outcome.text }] } }
}

function stepCall(step) {
  const call = { subagent_type: step.subagent_type, description: step.description, prompt: step.prompt }
  const named = /\((haiku|sonnet|opus)(?: (low|medium|high|xhigh|max))?\)/.exec(step.outcome?.text ?? '')
  if (named !== null) {
    call.model = named[1]
    if (named[2] !== undefined) call.effort = named[2]
  }
  return call
}

const rungRank = (model, effort) => ({ haiku: 1, sonnet: 2, opus: 3, fable: 4 })[model] * 10 + (model === 'haiku' ? 0 : EFFORT_RANK[effort ?? SESSION_EFFORT])

function actionOf(r, prev) {
  if (r.notice === 'needs-person') return 'needs-person'
  if (r.notice === 'stop') return 'stop'
  if (prev === undefined) return 'no-change'
  const now = rungRank(r.model, r.effort)
  const before = rungRank(prev.model, prev.effort)
  if (now > before) return 'escalate'
  if (FAILED.has(prev.kind)) return now === before ? 'retry-same' : 'dropped'
  return now < before ? 'dropped' : 'no-change'
}

function runChain(chain) {
  const points = CHAIN_POINTS[chain.id] ?? []
  const stepLines = new Set(points.filter(p => p[1] === 'step').map(p => p[0]))
  let memos = []
  let now = 1_000_000
  const ran = []
  for (const [i, step] of chain.steps.entries()) {
    const call = stepCall(step)
    const r = spawn(call, memos, now)
    memos = r.settle(r.memos, resultOf(step.outcome, `a${i}`))
    const prevRan = ran.at(-1)
    logSpawn(`${chain.id}-${i + 1}`, call, r, r.notice === 'escalate' && prevRan !== undefined ? { record: { mode: 'escalated', escalation: { from: `${prevRan.model}${prevRan.effort ? ` ${prevRan.effort}` : ''}`, to: `${r.model}${r.effort ? ` ${r.effort}` : ''}`, cause: step.outcome.kind } } } : {})
    logOutcome(`${chain.id}-${i + 1}`, KIND[step.outcome.kind] ?? 'ok')
    ran.push({ ...r, kind: step.outcome.kind, step, memosAfter: memos, now })
    now += 5 * 60_000
  }
  const sameTask = (a, b) => a.subagent_type === b.subagent_type && a.description === b.description
  const out = []
  for (const [k, where, expected, extra] of points) {
    let r
    let prev
    let on
    if (where === 'step') {
      r = ran[k - 1]
      const earlier = ran.slice(0, k - 1).reverse().find(x => sameTask(x.step, ran[k - 1].step))
      prev = earlier
      on = `spawn ${k}`
    } else {
      const next = chain.steps[k]
      if (next !== undefined && sameTask(next, chain.steps[k - 1]) && !stepLines.has(k + 1)) {
        r = ran[k]
        on = `spawn ${k + 1}`
      } else {
        r = spawn(stepCall(chain.steps[k - 1]), ran[k - 1].memosAfter, ran[k - 1].now + 5 * 60_000)
        on = `repeat of step ${k}`
      }
      prev = ran[k - 1]
    }
    const action = actionOf(r, prev)
    const sameRung = prev !== undefined && r.notice === undefined && rungRank(r.model, r.effort) === rungRank(prev.model, prev.effort)
    let ok = expected.includes(action) || (expected.includes('same-rung') && sameRung)
    let note
    if (ok && extra === 'reason') {
      const reason = /ESCALATE:\s*(.{0,40})/.exec(prev.step.outcome.text)?.[1] ?? ''
      if (!r.prompt.includes(reason.trim())) {
        ok = false
        note = 'escalated without the agent reason'
      }
    }
    out.push({ chain: chain.id, point: `${where} ${k}`, on, expected, action, ok, route: `${r.model}${r.effort ? ` ${r.effort}` : ''}`, ...(note ? { note } : {}) })
  }
  return out
}

// ---------- run ----------
const taskRows = runTasks()
const chainRows = CHAINS.flatMap(runChain)
const result = {
  label,
  version,
  preset: preset ?? null,
  assumptions: { SESSION_MODEL, SESSION_EFFORT, IN_MULT, OUT_MULT, EFFORT_OUT, PRICE },
  tasks: { all: summarize(taskRows), dev: summarize(taskRows.filter(r => r.split === 'dev')), holdout: summarize(taskRows.filter(r => r.split === 'holdout')) },
  chains: {
    points: chainRows.length,
    correct: chainRows.filter(r => r.ok).length,
    correct_pct: Math.round((1000 * chainRows.filter(r => r.ok).length) / chainRows.length) / 10,
    by_expected: Object.fromEntries(
      ['escalate', 'retry-same', 'stop', 'no-change', 'needs-person'].map(k => {
        const of = chainRows.filter(r => r.expected[0] === k)
        return [k, { n: of.length, correct: of.filter(r => r.ok).length }]
      }),
    ),
    rows: chainRows,
  },
  rows: taskRows,
}
if (logFile !== undefined) writeFileSync(logFile, LOG.map(x => JSON.stringify(x)).join('\n') + '\n')
mkdirSync(join(HERE, 'results'), { recursive: true })
writeFileSync(join(HERE, 'results', `${label}.json`), `${JSON.stringify(result, null, 1)}\n`)

if (!quiet) {
  const line = (name, s) =>
    `${name.padEnd(8)} n=${String(s.n).padStart(3)}  under ${String(s.under).padStart(2)} (${s.under_pct}%)  exact ${s.exact_pct}%  within ${s.within_pct}%  correct ${s.correct_pct}%  over ${s.over} (${s.over_pct}%)  abstain ${s.abstain} (amb ${s.abstain_on_ambiguous}/${s.ambiguous})  cost ${s.cost_vs_opus_pct}% of all-opus`
  console.log(`agent-router ${version} — bench "${label}"${preset ? ` preset ${preset}` : ''}`)
  for (const k of ['all', 'dev', 'holdout']) console.log(line(k, result.tasks[k]))
  console.log(`chains   ${result.chains.correct}/${result.chains.points} decision points correct (${result.chains.correct_pct}%)`, JSON.stringify(result.chains.by_expected))
  console.log('traps   ', Object.entries(result.tasks.all.traps).map(([k, v]) => `${k} ${v.correct}/${v.n}`).join(', '))
  if (show !== 'none') {
    const bad = taskRows.filter(r => (show === 'all' || r.split === 'dev') && !r.correct)
    for (const r of bad)
      console.log(`  ${r.under ? 'UNDER' : r.over ? 'OVER ' : r.abstain ? 'ABST ' : 'MISS '} ${r.id} exp ${r.expected} acc [${r.acceptable}] min ${r.min_safe} → ${r.abstain ? 'abstain' : `${r.model} ${r.effort ?? ''}`} (${r.why})`)
    for (const c of chainRows.filter(r => !r.ok)) console.log(`  CHAIN ${c.chain} ${c.point} (${c.on}) expected ${c.expected.join('|')} got ${c.action} on ${c.route}${c.note ? ` — ${c.note}` : ''}`)
  }
}
