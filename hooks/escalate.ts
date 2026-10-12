import type { SpawnMemo } from '../types'
import { RANK } from './config'
import type { Choice, Effort, Escalate, Model } from './config'
import { ROUTE_LINE } from './policy'

export type Memo = SpawnMemo
export type Outcome = SpawnMemo['outcome']

export type Plan =
  | { kind: 'none' }
  | { kind: 'escalate'; from: Choice; to: Choice; cause: string; outcome: Outcome }
  | { kind: 'retry'; at: Choice; cause: string; outcome: Outcome; cooldown: boolean }
  | { kind: 'stay'; at: Choice }
  | { kind: 'stop'; cause: string }
  | { kind: 'top'; at: Choice; cause: string }

export const MEMO_LIMIT = 50

const EFFORT_RANK: Record<Effort, number> = { low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

const TAIL = 600

const FAILED_STATUS = /^\s*[*_`>-]*\s*status\s*[:=]\s*[*_`"']*\s*(failed|blocked)\b/im
const OK_STATUS = /^\s*[*_`>-]*\s*status\s*[:=]\s*[*_`"']*\s*(ok|done|success|succeeded|completed|passed)\b/im
const SIGNAL = /^\s*[*_`>]*\s*ESCALATE\s*[:—–-]\s*(.+)$/m
const REFUSAL =
  /^\s*(?:I(?:['’]m| am) (?:not able|unable) to help|I can(?:['’]t|not) (?:help|assist|do that|comply)|I won['’]t (?:help|do|be able)|I(?:['’]m| am) sorry, but I can(?:['’]t|not)|Я не (?:могу|буду) (?:помочь|помогать|это делать|выполнить)|Не могу помочь)/i
const OVERFLOW =
  /context (?:limit|window|length)(?: (?:was )?(?:reached|exceeded|full))?|prompt is too long|too many tokens|maximum context|ran out of context|output (?:was )?truncated|response was cut off|контекст\S*\s+(?:переполн|закончил|исчерпан)|лимит контекста/i
const TRANSIENT =
  /\btimed?[\s-]?out\b|\btimeout\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|\b(?:429|502|503|504)\b|rate[\s-]?limit|overloaded|temporarily unavailable|service unavailable|network error|connection (?:reset|refused|lost)|таймаут|превышено время ожидания|сервис недоступен/i

const FAILURE_PHRASES: readonly RegExp[] = [
  /\btests?\s+(?:are\s+|were\s+|still\s+)?(?:failed|failing|fail)\b/i,
  /\b(?:build|gate|check|checks|compilation|lint)\s+(?:has\s+|have\s+|still\s+)?(?:failed|fails|failing|fail)\b/i,
  /\bfailing tests?\b/i,
  /\b[\w.]*test[\w.]*\s+(?:still\s+)?(?:fails|failed|failing)\b/i,
  /\b\d+\s+(?:failures?|failed|errors?)\b/i,
  /\bstill\s+(?:fails?|failing|broken|red|produces|reproduces|happens|crashes)\b/i,
  /\bfails?\s+\d+\s+(?:of|out of|in)\s+\d+/i,
  /\b(?:not|isn['’]t|wasn['’]t)\s+(?:green|resolved|fixed)\b/i,
  /\bdid not pass\b|\bdidn't pass\b/i,
  /\b(?:could not|couldn't|was unable to|unable to) (?:fix|finish|complete|make|get|resolve)\b/i,
  /не\s+прош(?:ли|ёл|ел|ла)/i,
  /(?:^|[^\p{L}])(?:упал|упала|упали|падает|падают)(?![\p{L}])/iu,
  /не\s+удал(?:ось|ось\s+исправить)/i,
  /не\s+получилось/i,
  /всё\s+ещё\s+(?:не\s+работает|падает|красн)|по-прежнему\s+(?:не\s+работает|падает)/i,
  /не\s+собирается|сборка\s+(?:упала|сломана|не\s+прошла)/i,
]

function firstLine(text: string): string {
  return (text.split('\n').find(l => l.trim() !== '') ?? '').trim().slice(0, 80)
}

export function classify(input: { isError?: boolean; text: string; reason?: string }): { outcome: Outcome; cause?: string } {
  if (input.reason === 'aborted') return { outcome: 'neutral' }
  if (input.reason === 'refusal') return { outcome: 'refusal', cause: firstLine(input.text) || 'refusal' }
  const signal = SIGNAL.exec(input.text)
  if (signal !== null) return { outcome: 'signal', cause: (signal[1] ?? '').trim().slice(0, 200) }
  if (input.isError === true || input.reason === 'error') {
    if (OVERFLOW.test(input.text)) return { outcome: 'overflow', cause: firstLine(input.text) || 'context overflow' }
    if (TRANSIENT.test(input.text)) return { outcome: 'transient', cause: firstLine(input.text) || 'timeout' }
    return { outcome: 'error', cause: firstLine(input.text) || input.reason || 'error' }
  }
  if (REFUSAL.test(input.text)) return { outcome: 'refusal', cause: firstLine(input.text) }
  const tail = input.text.slice(-TAIL)
  const failed = FAILED_STATUS.exec(tail)
  if (failed !== null) return { outcome: 'check', cause: `status ${failed[1]?.toLowerCase()}` }
  if (OK_STATUS.test(tail)) return { outcome: 'ok' }
  if (OVERFLOW.test(tail)) return { outcome: 'overflow', cause: firstLine(input.text) }
  for (const re of FAILURE_PHRASES) {
    const m = re.exec(tail)
    if (m !== null) return { outcome: 'check', cause: m[0].trim().replace(/^[^\p{L}]+/u, '') }
  }
  return { outcome: 'ok' }
}

const USER_RETRY =
  /(?<![\p{L}])(?:ещё раз|еще раз|опять|снова|всё ещё не|все еще не|по-прежнему не|до сих пор не|не помогло|не исправилось|try again|one more time|still (?:failing|fails|broken|not working|doesn['’]t work|does not work|wrong|happening)|again,|didn['’]t (?:fix|work|help)|not fixed|same (?:bug|error|problem))(?![\p{L}])/iu

export function isUserRetry(prompt: string): boolean {
  return USER_RETRY.test(prompt.replace(ROUTE_LINE, ''))
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function fingerprint(prompt: string): string {
  return normalize(prompt.replace(ROUTE_LINE, '')).slice(0, 500)
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
  return out
}

export function similarity(a: string, b: string): number {
  if (a === '' || b === '') return 0
  if (a === b) return 1
  const ta = trigrams(a)
  const tb = trigrams(b)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared || 1)
}

export function sameTask(m: Memo, type: string, desc: string, fp: string): boolean {
  if (m.type !== type) return false
  if (desc !== '' && m.desc === desc) return true
  return similarity(m.fp, fp) >= 0.8
}

export function complaintTarget(
  memos: readonly Memo[],
  call: { type: string; desc: string; fp: string; prompt: string },
  now: number,
  cfg: Escalate,
): Memo | undefined {
  if (!cfg.enabled || !isUserRetry(call.prompt)) return undefined
  const since = now - cfg.window_min * 60_000
  const last = memos
    .filter(m => m.at >= since && m.type === call.type && m.outcome !== 'pending' && m.outcome !== 'neutral')
    .reverse()
    .sort((a, b) => b.at - a.at)[0]
  if (last === undefined || last.fp === call.fp) return undefined
  const related = (call.desc !== '' && last.desc === call.desc) || similarity(last.fp, call.fp) >= 0.25
  return related && last.outcome === 'ok' ? last : undefined
}

function rungIndex(ladder: Choice[], c: Choice): number {
  let index = -1
  ladder.forEach((r, i) => {
    const below =
      RANK[r.model] < RANK[c.model] ||
      (r.model === c.model && EFFORT_RANK[r.effort ?? 'low'] <= EFFORT_RANK[c.effort ?? 'low'])
    if (below) index = i
  })
  return index
}

export function above(a: Choice, b: Choice): boolean {
  if (RANK[a.model] !== RANK[b.model]) return RANK[a.model] > RANK[b.model]
  return EFFORT_RANK[a.effort ?? 'low'] > EFFORT_RANK[b.effort ?? 'low']
}

const NOW: readonly Outcome[] = ['signal', 'overflow']

export function plan(
  memos: readonly Memo[],
  call: { type: string; desc: string; fp: string },
  now: number,
  cfg: Escalate,
  cap: Model,
  maxEffort: Effort = 'max',
): Plan {
  if (!cfg.enabled) return { kind: 'none' }
  const since = now - cfg.window_min * 60_000
  const related = memos
    .filter(m => m.at >= since && sameTask(m, call.type, call.desc, call.fp))
    .reverse()
    .sort((a, b) => b.at - a.at)
  const failures: Memo[] = []
  let lastOk: Memo | undefined
  for (const m of related) {
    if (m.outcome === 'pending' || m.outcome === 'neutral') continue
    if (m.outcome === 'ok') {
      lastOk = m
      break
    }
    failures.push(m)
  }
  const last = failures[0]
  if (last === undefined) {
    if (lastOk?.lifted === true) return { kind: 'stay', at: { model: lastOk.model, ...(lastOk.effort ? { effort: lastOk.effort } : {}) } }
    return { kind: 'none' }
  }
  const from: Choice = { model: last.model, ...(last.effort ? { effort: last.effort } : {}) }
  const cause = last.cause ?? last.outcome
  if (last.outcome === 'refusal') return { kind: 'stop', cause }
  const sameRung = failures.filter(m => m.model === last.model && m.effort === last.effort)
  const count = (o: Outcome) => sameRung.filter(m => m.outcome === o).length
  const now_ = NOW.includes(last.outcome)
  const due =
    now_ ||
    count('error') >= cfg.after.error ||
    count('check') >= cfg.after.check ||
    count('transient') >= cfg.after.transient ||
    count('complaint') >= cfg.after.complaint ||
    sameRung.length >= 3
  if (!due) return { kind: 'retry', at: from, cause, outcome: last.outcome, cooldown: false }
  const allowed = cfg.ladder.filter(
    r => r.model !== 'fable' && RANK[r.model] <= RANK[cap] && (r.effort === undefined || EFFORT_RANK[r.effort] <= EFFORT_RANK[maxEffort]),
  )
  const to = allowed[rungIndex(allowed, from) + 1]
  if (to === undefined || !above(to, from)) return { kind: 'top', at: from, cause }
  if (!now_ && sameRung.length === 1 && last.escalated === true) return { kind: 'retry', at: from, cause, outcome: last.outcome, cooldown: true }
  return { kind: 'escalate', from, to: { model: to.model, ...(to.model !== 'haiku' && to.effort ? { effort: to.effort } : {}) }, cause, outcome: last.outcome }
}

export function remember(memos: readonly Memo[], memo: Memo): Memo[] {
  return [...memos.filter(m => m.id !== memo.id), memo].slice(-MEMO_LIMIT)
}

export function settle(memos: readonly Memo[], match: (m: Memo) => boolean, patch: Partial<Memo>): Memo[] {
  return memos.map(m => (match(m) ? { ...m, ...patch } : m))
}

type AgentResult = {
  deny?: string
  isError?: true
  text?: string
  result?: unknown
}

export function outcomeOf(result: AgentResult): Partial<SpawnMemo> {
  if (result.deny !== undefined) return { outcome: 'neutral' }
  if (result.isError === true) return classify({ isError: true, text: result.text ?? '' })
  const r = (result.result ?? {}) as {
    status?: string
    agentId?: string
    content?: { text?: string }[]
    handbackReport?: { text?: string }
  }
  const agentId = typeof r.agentId === 'string' ? { agentId: r.agentId } : {}
  if (r.status !== undefined && r.status !== 'completed') return { outcome: 'pending', ...agentId }
  const text = r.handbackReport?.text ?? r.content?.map(c => c.text ?? '').join('\n') ?? result.text ?? ''
  return { ...classify({ text }), ...agentId }
}
