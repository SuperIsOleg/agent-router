import { RANK } from './config'
import type { Choice, Config, Effort, KeywordTier, Model, Rule, Tier } from './config'
import { keywordPattern, maskNegations, pathsIn, splitCode, typedText, wordCount } from './text'

export type Role = 'search' | 'plan' | 'review' | 'write' | 'unknown'

export type Definition = {
  role?: Role
  ownModel?: Model
  isModelKnown: boolean
  fallbackModel: Model
}

export type AgentCall = {
  subagent_type?: string
  description?: string
  prompt?: string
  model?: string
  effort?: string
}

export type Route = { model: Model; effort?: Effort; why: string }

export type Decision =
  | { kind: 'keep'; why: string }
  | { kind: 'abstain'; model?: Model; effort?: Effort; why: string; route: Route }
  | { kind: 'fill'; model?: Model; effort?: Effort; why: string; route: Route }
  | { kind: 'auto'; model?: Model; effort?: Effort; tier: Tier; why: string; route: Route }

export const ROUTE_LINE =
  /^\s*route:\s*(haiku|sonnet|opus|fable)\b[ \t]*(low|medium|high|xhigh|max)?\b[ \t]*(?:[—–-]+)?(.*)$/im

const BUILT_IN_ROLES: Record<string, Role> = {
  'general-purpose': 'write',
  Explore: 'search',
  Plan: 'plan',
  'claude-code-guide': 'search',
}

export function parseRoute(prompt: string | undefined): Route | undefined {
  const m = ROUTE_LINE.exec(prompt ?? '')
  if (m === null) return undefined
  const model = (m[1] ?? '').toLowerCase() as Model
  const effort = m[2]?.toLowerCase() as Effort | undefined
  return { model, effort, why: (m[3] ?? '').trim() }
}

export function routeLine(r: Route): string {
  return `route: ${r.model}${r.effort !== undefined ? ` ${r.effort}` : ''} — ${r.why}`
}

const patterns = new Map<string, RegExp>()

function patternOf(word: string): RegExp {
  let re = patterns.get(word)
  if (re === undefined) {
    re = keywordPattern(word)
    patterns.set(word, re)
  }
  return re
}

export function findKeyword(text: string, words: readonly string[]): string | undefined {
  const lower = text.toLowerCase()
  for (const word of words) if (patternOf(word).test(lower)) return word.replace(/\*/g, '')
  return undefined
}

function findAll(text: string, words: readonly string[]): { word: string; index: number }[] {
  const lower = text.toLowerCase()
  const out: { word: string; index: number }[] = []
  for (const word of words) {
    const m = patternOf(word).exec(lower)
    if (m !== null) out.push({ word: word.replace(/\*/g, ''), index: m.index })
  }
  return out
}

export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map(p => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  return re.test(value)
}

export function roleFromText(text: string): Role {
  const t = text.toLowerCase()
  const readOnly =
    /read-only|read only|readonly|never edits|does not edit|doesn't edit|no edits|without editing|только чтени|ничего не меня|не правит/.test(t)
  const writes = /writes? code|implement|engineer|developer|\bcoder\b|\bwriter\b|the only agent that writes|пишет код|реализу|разработчик/.test(t)
  if (/\breview|audit|ревью|ревьюер/.test(t) && !writes) return 'review'
  if (/\bplan(ner|ning)?\b|architect|analyst|researcher|планир|архитектор|аналитик|исследоват/.test(t) && !writes) return 'plan'
  if (readOnly || /\bsearch|\bexplore|\blocate|\bfind\b|поиск|ищет/.test(t)) return writes ? 'write' : 'search'
  if (writes) return 'write'
  return 'unknown'
}

const WRITE_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']

export function parseDefinition(markdown: string): Omit<Definition, 'fallbackModel'> {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(markdown)
  const front = m?.[1] ?? ''
  const field = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(front)?.[1]?.trim()
  const model = field('model')
  const tools = field('tools')
  const disallowed = field('disallowedTools')
  const description = field('description') ?? ''
  const ownModel = aliasOf(model)
  const listed = (s: string | undefined) => (s ?? '').split(/[\s,[\]"']+/).filter(Boolean)
  const lacksWrite =
    (tools !== undefined && tools !== '' && !listed(tools).some(t => WRITE_TOOLS.includes(t) || t === '*')) ||
    WRITE_TOOLS.slice(0, 2).every(t => listed(disallowed).includes(t))
  const fromText = roleFromText(description)
  const role: Role = lacksWrite ? (fromText === 'review' || fromText === 'plan' ? fromText : 'search') : fromText === 'unknown' ? 'write' : fromText
  return { role, ownModel, isModelKnown: true }
}

export function aliasOf(model: string | undefined): Model | undefined {
  const m = (model ?? '').toLowerCase()
  return (['haiku', 'sonnet', 'opus', 'fable'] as const).find(alias => m.includes(alias))
}

function tierFor(role: Role, keyword: Tier | undefined): Tier {
  switch (role) {
    case 'search':
      return keyword === 'risky' || keyword === 'deep' ? 'ordinary' : keyword === 'mechanical' ? 'search' : 'search'
    case 'plan':
    case 'review':
      return keyword === 'risky' || keyword === 'deep' ? keyword : 'ordinary'
    default:
      return keyword ?? 'ordinary'
  }
}

export type Hit = { tier: KeywordTier; word: string; where: 'head' | 'body' | 'code' }

export type Reading = {
  text: string
  hits: Hit[]
  words: number
  chars: number
  limiter: boolean
  search: boolean
  vague: boolean
  backref: boolean
}

const UI_AFTER = /^[\s\p{P}]*(?:\p{L}+\s+)?(?:screens?|pages?|buttons?|labels?|text|copy|titles?|banners?|icons?|tabs?|sheets?|modals?|dialogs?|placeholders?|tooltips?|strings?|captions?|badges?|snapshots?|stor(?:y|ies)|colou?rs?|fonts?|layouts?|images?|logos?|illustrations?|wording)(?![\p{L}])/iu
const UI_BEFORE = /(?:экран|кнопк|текст|надпис|заголов|страниц|вкладк|иконк|баннер|подпис|цвет|шрифт|макет|плашк|картинк)\p{L}*\s+(?:\p{L}+\s+)?$/iu
const LIMITER = /(?<![\p{L}])(?:(?:just|only|simply)\s+(?:need to\s+|have to\s+|want you to\s+)?(?:add|fix|update|change|rename|move|bump|replace|remove|delete|format|re-?run|run|write|draft|correct|tweak|adjust|set|make|insert|paste|copy)|nothing else|no other changes|that'?s all|(?:просто|только)\s+(?:нужно\s+|надо\s+)?(?:добав|поправ|исправ|обнов|замени|измени|переимен|перенес|удали|запусти|перезапусти|напиши|поменяй|сделай|вставь|скопируй)\p{L}*|больше ничего|ничего больше|ничего другого|и всё)(?![\p{L}])/iu
const SEARCH_VERB = /^(?:\W*)(?:please\s+)?(?:find|list|count|locate|search|grep|show me|show|where (?:is|are|do|does)|how many|which (?:files|modules|places)|enumerate|collect|найди|найти|перечисли|посчитай|покажи|выведи|выпиши|собери список|где|сколько|какие файлы)(?![\p{L}])/iu
const WRITE_VERB = /(?<![\p{L}])(?:fix|add|implement|change|write|update|refactor|create|build|remove|delete|rename|move|migrate|make|convert|replace|edit|modify|patch|bump|upgrade|install|deploy|why|explain|compare|analy[sz]e|investigate|исправ\p{L}*|добав\p{L}*|реализ\p{L}*|измени\p{L}*|напиши|обнови|создай|сделай|удали|переименуй|перенеси|поправь|почини|замени|почему|объясни|сравни|проанализируй|разбер\p{L}*)(?![\p{L}])/iu
const BACKREF = /(?<![\p{L}])(?:same as (?:last time|before|yesterday)|like (?:last time|before|yesterday)|as (?:last time|before|we discussed|discussed)|the usual|как в прошлый раз|как раньше|как вчера|как обычно|как договаривались|то же самое)(?![\p{L}])/iu

export function readBrief(call: AgentCall, config: Config): Reading {
  const prose = (raw: string) => splitCode(maskNegations(typedText(raw.replace(ROUTE_LINE, ''))))
  const description = prose(call.description ?? '')
  const prompt = prose(call.prompt ?? '')
  const lines = prompt.text.split('\n')
  const first = lines.findIndex(l => l.trim() !== '')
  const head = `${description.text}\n${first < 0 ? '' : lines[first]}`
  const body = first < 0 ? '' : lines.slice(first + 1).join('\n')
  const code = `${description.code}\n${prompt.code}`
  const hits: Hit[] = []
  const seen = new Set<string>()
  const add = (tier: KeywordTier, text: string, where: Hit['where']) => {
    for (const { word, index } of findAll(text, config.keywords[tier])) {
      if (seen.has(`${tier}:${word}`)) continue
      seen.add(`${tier}:${word}`)
      const weak = where !== 'code' && tier !== 'mechanical' && (UI_AFTER.test(text.slice(index + word.length).replace(/^\p{L}*/u, '')) || UI_BEFORE.test(text.slice(0, index)))
      hits.push({ tier, word, where: weak ? 'code' : where })
    }
  }
  for (const tier of ['deep', 'risky'] as const) {
    add(tier, head, 'head')
    add(tier, body, 'body')
    add(tier, code, 'code')
  }
  add('mechanical', head, 'head')
  const text = `${description.text}\n${prompt.text}`.trim()
  const words = wordCount(prompt.text)
  const firstSentence = (prompt.text.split(/[.!?\n]/).find(l => l.trim() !== '') ?? '').trim()
  return {
    text,
    hits,
    words,
    chars: prompt.text.length,
    limiter: LIMITER.test(text),
    search: SEARCH_VERB.test(firstSentence) && !WRITE_VERB.test(prompt.text),
    vague: words < 4,
    backref: BACKREF.test(text),
  }
}

export type Verdict =
  | { kind: 'tier'; tier: Tier; role: Role; word?: string; floor?: boolean }
  | { kind: 'abstain'; role: Role; why: 'mixed' | 'no-signal' | 'vague' | 'backref'; word?: string }

export function judge(role: Role, r: Reading, config: Config): Verdict {
  const expensive = r.hits.filter(h => h.tier !== 'mechanical')
  const strong = expensive.filter(h => h.where !== 'code')
  const weakWords = new Set(expensive.filter(h => h.where === 'code').map(h => h.word))
  const fires = strong.length > 0 || weakWords.size >= 2
  const mechanical = r.hits.find(h => h.tier === 'mechanical')
  const cheapCue = mechanical !== undefined || r.limiter || r.search
  let keyword: Tier | undefined
  let word: string | undefined
  if (fires) {
    const lead = strong.find(h => h.tier === 'deep') ?? strong[0] ?? expensive[0]
    word = lead?.word
    if (config.abstain && cheapCue && !strong.some(h => h.where === 'head') && role !== 'plan' && role !== 'review')
      return { kind: 'abstain', role, why: 'mixed', word }
    keyword = strong.some(h => h.tier === 'deep') || (strong.length === 0 && expensive.some(h => h.tier === 'deep')) ? 'deep' : 'risky'
  } else if (mechanical !== undefined) {
    keyword = 'mechanical'
    word = mechanical.word
  } else if (r.search && (role === 'write' || role === 'unknown')) {
    keyword = 'search'
  }
  if (keyword === undefined && config.abstain) {
    if (role === 'unknown') return { kind: 'abstain', role, why: 'no-signal' }
    if (role === 'write' && r.backref) return { kind: 'abstain', role, why: 'backref' }
    if (role === 'write' && r.vague) return { kind: 'abstain', role, why: 'vague' }
  }
  let tier = tierFor(role, keyword)
  let floor = false
  if (config.tiers[tier].model === 'haiku' && r.chars >= config.long_brief) {
    tier = config.tiers.mechanical.model === 'haiku' ? 'ordinary' : 'mechanical'
    floor = true
  }
  return { kind: 'tier', tier, role, ...(word !== undefined && keyword !== undefined ? { word } : {}), ...(floor ? { floor } : {}) }
}

export function keywordHit(call: AgentCall, config: Config): { tier: KeywordTier; word: string } | undefined {
  const v = judge('write', readBrief(call, config), { ...config, abstain: false })
  if (v.kind !== 'tier' || v.word === undefined) return undefined
  return v.tier === 'deep' || v.tier === 'risky' || v.tier === 'mechanical' ? { tier: v.tier, word: v.word } : undefined
}

export function clampModel(model: Model, cap: Model): Model {
  return RANK[model] > RANK[cap] ? cap : model
}

function effortFor(model: Model, effort: Effort | undefined): Effort | undefined {
  return model === 'haiku' ? undefined : effort
}

export type Labels = {
  auto: string
  role: Record<Role, string>
  keyword: (word: string, tier: Tier) => string
  configType: (type: string) => string
  ownModel: string
  unknownModel: string
  callerModel: string
  capped: (cap: Model) => string
  abstain: (why: string) => string
  abstainWhy: { mixed: (word: string) => string; 'no-signal': string; vague: string; backref: string }
  longBrief: string
  projectDefault: string
  rule: (name: string) => string
  effortCapped: (cap: Effort) => string
}

export function typeOf(call: AgentCall): string {
  return call.subagent_type === undefined || call.subagent_type.trim() === '' ? 'general-purpose' : call.subagent_type
}

export function roleOfType(type: string): Role {
  const name = (type.split(':').at(-1) ?? type).replace(/[-_]+/g, ' ')
  return roleFromText(name)
}

export function decide(call: AgentCall, def: Definition, config: Config, labels: Labels): Decision {
  const type = typeOf(call)
  const route = parseRoute(call.prompt)
  const given = call.model as Model | undefined
  const givenEffort = call.effort as Effort | undefined

  if (route !== undefined) {
    const model = given ?? route.model
    const effort = givenEffort ?? effortFor(model, route.effort)
    const fill: { model?: Model; effort?: Effort } = {}
    if (given === undefined) fill.model = model
    if (givenEffort === undefined && effort !== undefined) fill.effort = effort
    if (fill.model === undefined && fill.effort === undefined) return { kind: 'keep', why: route.why }
    return { kind: 'fill', ...fill, why: route.why, route }
  }

  const ruled = matchRule(config, type, call)
  if (ruled !== undefined && 'abstain' in ruled.rule)
    return abstain(def, config, labels, given, givenEffort, labels.rule(ruled.name))
  const rule = ruled !== undefined && !('auto' in ruled.rule) ? { key: ruled.name, rule: ruled.rule as Choice | { tier: Tier } } : matchType(config, type)
  const label = (key: string) => (ruled !== undefined && !('auto' in ruled.rule) ? labels.rule(key) : labels.configType(key))
  let choice: Choice
  let tier: Tier
  let why: string
  if (rule !== undefined && 'model' in rule.rule) {
    choice = { model: rule.rule.model, ...(rule.rule.effort !== undefined ? { effort: rule.rule.effort } : {}) }
    tier = 'ordinary'
    why = label(rule.key)
  } else if (rule !== undefined && 'tier' in rule.rule) {
    tier = rule.rule.tier
    choice = config.tiers[tier]
    why = label(rule.key)
  } else {
    const known = def.role ?? BUILT_IN_ROLES[type]
    const role: Role = known ?? (call.subagent_type === undefined || call.subagent_type.trim() === '' ? 'write' : roleOfType(type))
    const verdict = judge(role, readBrief(call, config), config)
    if (verdict.kind === 'abstain') {
      const reason = verdict.why === 'mixed' ? labels.abstainWhy.mixed(verdict.word ?? '') : labels.abstainWhy[verdict.why]
      return abstain(def, config, labels, given, givenEffort, reason)
    }
    tier = verdict.tier
    choice = config.tiers[tier]
    why =
      verdict.word !== undefined && tierFor(role, undefined) !== tier
        ? `${labels.role[role]}, ${labels.keyword(verdict.word, tier)}`
        : labels.role[role]
    if (verdict.floor === true) why = `${why}, ${labels.longBrief}`
  }

  const forced = rule !== undefined && 'model' in rule.rule
  const routed = clampModel(choice.model, config.max_model)
  if (routed !== choice.model) why = `${why}, ${labels.capped(config.max_model)}`
  let model: Model = routed
  if (given !== undefined) {
    model = given
    why = `${why}, ${labels.callerModel}`
  } else if (!forced && def.ownModel !== undefined) {
    model = def.ownModel
    why = `${why}, ${labels.ownModel}`
  } else if (!forced && !def.isModelKnown) {
    model = def.fallbackModel
    why = `${why}, ${labels.unknownModel}`
  }
  const setsModel = given === undefined && (forced || (def.ownModel === undefined && def.isModelKnown))
  const capped = clampEffort(choice.effort, config.max_effort)
  if (capped !== choice.effort && !forced) why = `${why}, ${labels.effortCapped(config.max_effort)}`
  const effort = givenEffort ?? effortFor(model, forced ? choice.effort : capped)

  const out: Route = { model, effort, why: `${labels.auto}: ${why}` }
  return {
    kind: 'auto',
    model: setsModel ? model : undefined,
    effort: givenEffort === undefined ? effort : undefined,
    tier,
    why: out.why,
    route: out,
  }
}

function abstain(def: Definition, config: Config, labels: Labels, given: Model | undefined, givenEffort: Effort | undefined, reason: string): Decision {
  const fallback = config.default
  const useDefault = given === undefined && def.ownModel === undefined && fallback !== undefined
  const model: Model = given ?? def.ownModel ?? (useDefault && fallback !== undefined ? clampModel(fallback.model, config.max_model) : def.fallbackModel)
  const effort = givenEffort ?? (useDefault ? effortFor(model, clampEffort(fallback?.effort, config.max_effort)) : undefined)
  const why = `${labels.auto}: ${labels.abstain(useDefault ? `${reason}; ${labels.projectDefault}` : reason)}`
  const route: Route = { model, effort, why }
  return {
    kind: 'abstain',
    ...(useDefault ? { model } : {}),
    ...(givenEffort === undefined && effort !== undefined ? { effort } : {}),
    why,
    route,
  }
}

const EFFORT_ORDER: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function clampEffort(effort: Effort | undefined, cap: Effort): Effort | undefined {
  if (effort === undefined) return undefined
  return EFFORT_ORDER.indexOf(effort) > EFFORT_ORDER.indexOf(cap) ? cap : effort
}

function pathGlob(pattern: string): RegExp {
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? ''
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*'
      i++
      if (pattern[i + 1] === '/') i++
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^(?:\\./)?${re}$`)
}

export function ruleMatches(rule: Rule, type: string, call: AgentCall): boolean {
  if (rule.default === true) return true
  const m = rule.match
  const prompt = (call.prompt ?? '').replace(ROUTE_LINE, '').trim()
  if (m.type !== undefined && !(Array.isArray(m.type) ? m.type : [m.type]).some(p => globMatch(p, type))) return false
  if (m.min_chars !== undefined && prompt.length < m.min_chars) return false
  if (m.max_chars !== undefined && prompt.length > m.max_chars) return false
  if (m.regex !== undefined && !new RegExp(m.regex, 'iu').test(`${call.description ?? ''}\n${prompt}`)) return false
  if (m.paths !== undefined) {
    const found = pathsIn(`${call.description ?? ''}\n${prompt}`)
    const globs = m.paths.map(pathGlob)
    if (!found.some(p => globs.some(g => g.test(p)))) return false
  }
  return true
}

function matchRule(config: Config, type: string, call: AgentCall): { name: string; rule: Rule } | undefined {
  for (const [i, rule] of config.rules.entries())
    if (ruleMatches(rule, type, call)) return { name: rule.name ?? (rule.default === true ? 'default' : `#${i + 1}`), rule }
  return undefined
}

function matchType(config: Config, type: string) {
  const exact = config.types[type]
  if (exact !== undefined) return { key: type, rule: exact }
  for (const [key, rule] of Object.entries(config.types)) if (key.includes('*') && globMatch(key, type)) return { key, rule }
  return undefined
}

export function aboveCap(model: string | undefined, cap: Model): boolean {
  if (model === undefined) return false
  if (model === 'fable') return true
  const rank = RANK[model as Model]
  return rank !== undefined && rank > RANK[cap]
}

export function skipReason(
  call: AgentCall & { isolation?: string; agentId?: string },
  config: Config,
): 'isolation' | 'nested' | 'skip' | undefined {
  if (call.isolation !== undefined) return 'isolation'
  if (call.agentId !== undefined && !config.nested) return 'nested'
  const type = typeOf(call)
  return config.skip.some(pattern => globMatch(pattern, type)) ? 'skip' : undefined
}
