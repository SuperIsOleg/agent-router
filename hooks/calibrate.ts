import { DEFAULTS } from './config'
import type { Config } from './config'
import { findKeyword } from './policy'

export type LogRow = Record<string, unknown>

export type Proposal = {
  kind: 'keyword' | 'threshold' | 'target' | 'abstain'
  field: string
  value: unknown
  why: string
}

export type Calibration = {
  spawns: number
  routed: number
  strong_share: number
  cheap_escalation_rate: number
  abstain_rate: number
  proposals: Proposal[]
}

type Spawn = {
  id: string
  type: string
  model: string
  mode: string
  tier: string
  description: string
  chars?: number
  outcome?: string
  escalatedFrom?: string
  next?: Spawn
}

const FAILED = new Set(['check', 'error', 'transient', 'overflow', 'signal', 'complaint'])
const CHEAP = new Set(['haiku', 'sonnet'])
const STRONG = new Set(['opus', 'fable'])
const STOP = new Set(
  (
    'the and for with from that this into when then than have has was were are not but all any its our your their them they what which where while there here more less only just also make sure each every some like such about after before over under same other new old one two three four five ' +
    'fix add update change write create build remove delete check test tests run make use using code file files page screen view model task bug issue please need want should would could will can ' +
    'это для что как все или его она они при так уже ещё еще нужно надо чтобы если только просто сделай добавь исправь поправь файл файлы код задача экран'
  ).split(' '),
)

const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((1000 * n) / of) / 10)

function words(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[\p{L}][\p{L}\p{N}-]{3,}/gu) ?? []).filter(w => !STOP.has(w)))]
}

function spawnsOf(rows: LogRow[]): Spawn[] {
  const byId = new Map<string, Spawn>()
  const list: Spawn[] = []
  for (const r of rows) {
    const kind = r.kind
    if (kind === 'outcome') {
      const s = byId.get(String(r.id))
      if (s !== undefined) s.outcome = String(r.outcome)
      continue
    }
    if (kind !== undefined) continue
    if (r.mode === 'untouched' || r.mode === 'denied') continue
    const escalation = r.escalation as { from?: string; to?: string | null } | undefined
    const s: Spawn = {
      id: String(r.id ?? `row${list.length}`),
      type: String(r.type ?? ''),
      model: String(r.model ?? ''),
      mode: String(r.mode ?? ''),
      tier: String(r.tier ?? ''),
      description: String(r.description ?? ''),
      ...(typeof r.chars === 'number' ? { chars: r.chars } : {}),
      ...(escalation?.to ? { escalatedFrom: String(escalation.from ?? '') } : {}),
    }
    const before = [...list].reverse().find(x => x.type === s.type && x.description === s.description && x.next === undefined)
    if (before !== undefined) before.next = s
    byId.set(s.id, s)
    list.push(s)
  }
  return list
}

export function calibrate(rows: LogRow[], config: Config = DEFAULTS): Calibration {
  const spawns = spawnsOf(rows)
  const routed = spawns.filter(s => s.mode !== 'explicit' && s.mode !== 'filled')
  const proposals: Proposal[] = []
  const cheap = routed.filter(s => CHEAP.has(s.model) && s.mode !== 'escalated')
  const needed = cheap.filter(s => s.outcome !== undefined && FAILED.has(s.outcome) && s.next?.escalatedFrom !== undefined)
  const fine = cheap.filter(s => s.outcome === 'ok')
  const strong = spawns.filter(s => STRONG.has(s.model)).length
  const abstained = routed.filter(s => s.mode === 'abstain').length

  const known = [...config.keywords.risky, ...config.keywords.deep]
  const counts = new Map<string, { hit: number; ok: number }>()
  for (const s of needed) for (const w of words(s.description)) counts.set(w, { hit: (counts.get(w)?.hit ?? 0) + 1, ok: 0 })
  for (const s of fine) for (const w of words(s.description)) if (counts.has(w)) counts.set(w, { hit: counts.get(w)?.hit ?? 0, ok: (counts.get(w)?.ok ?? 0) + 1 })
  const candidates = [...counts]
    .filter(([w, c]) => c.hit >= 2 && c.ok <= c.hit / 2 && findKeyword(w, known) === undefined)
    .sort((a, b) => b[1].hit - a[1].hit || a[1].ok - b[1].ok)
    .slice(0, 8)
  for (const [w, c] of candidates)
    proposals.push({
      kind: 'keyword',
      field: 'keywords.risky',
      value: w,
      why: `in ${c.hit} cheap-tier spawns that failed and were escalated, ${c.ok} that passed on a cheap tier`,
    })

  const haiku = routed.filter(s => s.model === 'haiku' && s.chars !== undefined && s.outcome !== undefined && s.mode !== 'escalated')
  let best: { at: number; above: number; below: number } | undefined
  for (const at of [500, 1000, 1500, 2500, 4000]) {
    const up = haiku.filter(s => (s.chars ?? 0) >= at)
    const down = haiku.filter(s => (s.chars ?? 0) < at)
    if (up.length < 3 || down.length < 3) continue
    const fail = (l: Spawn[]) => l.filter(s => FAILED.has(s.outcome ?? '')).length / l.length
    const above = fail(up)
    const below = fail(down)
    if (above >= 0.3 && above >= 2 * below && (best === undefined || above - below >= best.above - best.below)) best = { at, above, below }
  }
  if (best !== undefined && best.at !== config.long_brief)
    proposals.push({
      kind: 'threshold',
      field: 'long_brief',
      value: best.at,
      why: `haiku spawns with a prompt of ${best.at}+ characters failed ${Math.round(best.above * 100)}% of the time, shorter ones ${Math.round(best.below * 100)}%`,
    })

  const strongShare = Math.round(share(strong, spawns.length))
  const escalationRate = share(needed.length, cheap.length)
  const target =
    escalationRate > 15
      ? Math.min(100, Math.round(strongShare + share(needed.length, spawns.length)))
      : escalationRate < 5 && cheap.length >= 10
        ? Math.max(0, Math.round(strongShare - 5))
        : Math.round(strongShare)
  proposals.push({
    kind: 'target',
    field: 'strong_share',
    value: target,
    why:
      target > strongShare
        ? `${escalationRate}% of cheap-tier spawns failed and needed a stronger model; aim for about ${target}% on opus (now ${strongShare}%) by adding keywords or rules for those tasks`
        : target < strongShare
          ? `only ${escalationRate}% of cheap-tier spawns needed escalation; about ${target}% on opus (now ${strongShare}%) should hold — try the next keyword down or a tighter rule`
          : `${escalationRate}% of cheap-tier spawns needed escalation; ${strongShare}% on opus looks about right`,
  })

  const abstainRate = share(abstained, routed.length)
  if (abstainRate > 25)
    proposals.push({
      kind: 'abstain',
      field: 'default',
      value: { model: 'sonnet', effort: 'medium' },
      why: `${abstainRate}% of routed spawns abstained and ran on the agent's default; set "default" or add rules for those briefs`,
    })

  return {
    spawns: spawns.length,
    routed: routed.length,
    strong_share: strongShare,
    cheap_escalation_rate: escalationRate,
    abstain_rate: abstainRate,
    proposals,
  }
}

export function report(c: Calibration): string {
  const lines = [
    `agent-router calibrate — ${c.spawns} spawns, ${c.routed} routed by the router (proposals only; nothing is written)`,
    `on the strong model: ${c.strong_share}%   cheap-tier spawns that needed escalation: ${c.cheap_escalation_rate}%   abstained: ${c.abstain_rate}%`,
  ]
  for (const p of c.proposals) lines.push(`- ${p.field}: ${JSON.stringify(p.value)} — ${p.why}`)
  return lines.join('\n')
}
