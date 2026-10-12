import type { SpawnMemo } from '../types'
import type { Choice, Config, Effort, Model } from './config'
import { RANK } from './config'
import { above, complaintTarget, fingerprint, normalize, outcomeOf, plan, remember, settle } from './escalate'
import type { Plan } from './escalate'
import { aliasOf, decide, parseRoute, ROUTE_LINE, routeLine, typeOf } from './policy'
import type { AgentCall, Decision, Definition, Labels } from './policy'
import type { Texts } from './messages'
import { texts } from './messages'

export type Mode = 'auto' | 'explicit' | 'filled' | 'abstain' | 'escalated'

export type Spawn = {
  type: string
  decision: Decision
  model: string | undefined
  effort: Effort | undefined
  prompt: string
  why: string
  mode: Mode
  routed: Choice
  escalation?: { from: string; to: string | null; cause: string }
  complaint?: string
  notices: string[]
  step: Plan
  memo: SpawnMemo
}

export function show(c: Choice): string {
  return c.effort !== undefined && c.model !== 'haiku' ? `${c.model} ${c.effort}` : c.model
}

export function withRoute(prompt: string, line: string): string {
  return ROUTE_LINE.test(prompt) ? prompt.replace(ROUTE_LINE, line) : `${line}\n\n${prompt}`
}

function compose(base: string, line: string | undefined, extras: string[]): string {
  if (line === undefined) return base
  const head = [line, ...extras].join('\n')
  return ROUTE_LINE.test(base) ? base.replace(ROUTE_LINE, head) : `${head}\n\n${base}`
}

export function planSpawn(
  call: AgentCall,
  def: Definition,
  config: Config,
  t: Texts,
  memos: readonly SpawnMemo[],
  now: number,
  id: string,
): Spawn {
  const type = typeOf(call)
  const decision = decide(call, def, config, t.labels)
  let model: string | undefined = decision.kind === 'keep' ? call.model : (decision.model ?? call.model)
  let effort = call.effort as Effort | undefined
  if (effort === undefined && decision.kind !== 'keep') effort = decision.effort
  if (effort === undefined && decision.kind === 'keep') effort = parseRoute(call.prompt)?.effort
  const base = call.prompt ?? ''
  const routed = decision.kind === 'auto' || decision.kind === 'abstain'
  let line: string | undefined = routed ? routeLine(decision.route) : undefined
  const extras: string[] = []
  let why = decision.why
  let escalation: Spawn['escalation']
  const notices: string[] = []
  const desc = normalize(call.description ?? '')
  const fp = fingerprint(base)
  const routedModel = (): Model =>
    aliasOf(model) ?? (routed ? decision.route.model : (parseRoute(base)?.model ?? def.fallbackModel))

  let history = memos
  const target = complaintTarget(memos, { type, desc, fp, prompt: base }, now, config.escalate)
  if (target !== undefined) history = settle(memos, m => m.id === target.id, { outcome: 'complaint', cause: t.complaint })
  const step = plan(history, { type, desc, fp }, now, config.escalate, config.max_model, config.max_effort)
  const fresh: Choice = { model: routedModel(), ...(effort !== undefined ? { effort } : {}) }
  const explicit = call.model !== undefined || decision.kind === 'keep' || decision.kind === 'fill'
  let escalated = false
  let lifted = false
  if (step.kind === 'escalate' && above(step.to, fresh)) {
    const asked = explicit ? show(fresh) : undefined
    model = step.to.model
    effort = step.to.effort
    why = `${t.labels.auto}: ${t.retryWhy(show(step.from), step.cause)}`
    line = routeLine({ model: step.to.model, effort, why })
    extras.push(
      step.outcome === 'signal'
        ? t.carrySignal(show(step.from), step.cause)
        : step.outcome === 'overflow'
          ? t.carryOverflow(show(step.from))
          : t.carry(show(step.from), step.cause),
    )
    escalation = { from: show(step.from), to: show(step.to), cause: step.cause }
    escalated = true
    lifted = true
    notices.push(t.escalated(type, show(step.to), show(step.from), step.cause) + (asked !== undefined ? t.raisedCaller(asked) : ''))
  } else if (step.kind === 'retry' || step.kind === 'stay' || step.kind === 'top') {
    const at = step.at
    const pin = above(at, fresh) || (!explicit && above(fresh, at))
    if (pin) {
      model = at.model
      effort = at.model === 'haiku' ? undefined : at.effort
      why = `${t.labels.auto}: ${step.kind === 'stay' ? t.stayWhy(show(at)) : t.retryOnRungWhy(show(at), step.cause)}`
      line = routeLine({ model: at.model, effort, why })
    }
    lifted = above(at, fresh)
    if (step.kind === 'retry') {
      if (step.outcome !== 'complaint') extras.push(t.carry(show(at), step.cause))
      notices.push(t.retrying(type, show(at), step.cause))
    }
    if (step.kind === 'top') {
      escalation = { from: show(at), to: null, cause: step.cause }
      notices.push(t.needsPerson(show(at), step.cause))
    }
  } else if (step.kind === 'stop') {
    notices.push(t.stopped(type, step.cause))
  }

  const finalModel = routedModel()
  const finalEffort = finalModel === 'haiku' ? undefined : effort
  if (line !== undefined && config.escalate.enabled && config.escalate.protocol && RANK[finalModel] < RANK.opus)
    extras.unshift(t.protocol)
  const prompt = compose(base, line, extras)
  const mode: Mode =
    escalation?.to ? 'escalated' : decision.kind === 'auto' ? 'auto' : decision.kind === 'abstain' ? 'abstain' : decision.kind === 'fill' ? 'filled' : 'explicit'
  const memo: SpawnMemo = { id, type, desc, fp, model: finalModel, outcome: 'pending', at: now }
  if (finalEffort !== undefined) memo.effort = finalEffort
  if (escalated) memo.escalated = true
  if (lifted) memo.lifted = true
  return {
    type,
    decision,
    model,
    effort: finalEffort,
    prompt,
    why,
    mode,
    routed: { model: finalModel, ...(finalEffort !== undefined ? { effort: finalEffort } : {}) },
    ...(escalation !== undefined ? { escalation } : {}),
    ...(target !== undefined ? { complaint: target.id } : {}),
    notices,
    step,
    memo,
  }
}

export type BenchSpawn = {
  model: Model
  effort: Effort | undefined
  abstain: boolean
  prompt: string
  notice: 'escalate' | 'needs-person' | 'stop' | undefined
  why: string
  memos: SpawnMemo[]
  settle: (memos: SpawnMemo[], result: Parameters<typeof outcomeOf>[0]) => SpawnMemo[]
}

export function benchSpawn(call: AgentCall, def: Definition, config: Config, labels: Labels, memos: SpawnMemo[], now: number): BenchSpawn {
  const t = { ...texts('en'), labels }
  const id = `bench-${now}`
  const s = planSpawn(call, def, config, t, memos, now, id)
  const notice = s.escalation?.to ? 'escalate' : s.step.kind === 'top' ? 'needs-person' : s.step.kind === 'stop' ? 'stop' : undefined
  const before = s.complaint !== undefined ? settle(memos, m => m.id === s.complaint, { outcome: 'complaint', cause: t.complaint }) : memos
  return {
    model: s.routed.model,
    effort: s.routed.effort,
    abstain: s.mode === 'abstain' && s.decision.kind === 'abstain' && s.decision.model === undefined && s.decision.effort === undefined,
    prompt: s.prompt,
    notice,
    why: s.why,
    memos: remember(before, s.memo),
    settle: (list, result) => settle(list, m => m.id === id, outcomeOf(result)),
  }
}
