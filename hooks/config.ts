export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const TIERS = ['search', 'mechanical', 'ordinary', 'risky', 'deep'] as const
export const KEYWORD_TIERS = ['mechanical', 'risky', 'deep'] as const
export const MAIN_LOOP = ['off', 'effort', 'model'] as const

export type Model = (typeof MODELS)[number]
export type Effort = (typeof EFFORTS)[number]
export type Tier = (typeof TIERS)[number]
export type KeywordTier = (typeof KEYWORD_TIERS)[number]
export type Language = 'en' | 'ru'
export type MainLoop = (typeof MAIN_LOOP)[number]

export type Choice = { model: Model; effort?: Effort }
export type TypeRule = Choice | { tier: Tier }
export const PRESETS = ['thrifty', 'balanced', 'strict'] as const
export type Preset = (typeof PRESETS)[number]

export type RuleMatch = {
  type?: string | string[]
  regex?: string
  min_chars?: number
  max_chars?: number
  paths?: string[]
}
export type RuleAction = Choice | { tier: Tier } | { auto: true } | { abstain: true }
export type Rule = ({ match: RuleMatch; default?: undefined } | { default: true; match?: undefined }) & RuleAction & { name?: string }

export type Escalate = {
  enabled: boolean
  after: { error: number; check: number; transient: number; complaint: number }
  protocol: boolean
  window_min: number
  ladder: Choice[]
}

export type Config = {
  preset?: Preset
  rules: Rule[]
  max_effort: Effort
  abstain: boolean
  default?: Choice
  long_brief: number
  escalate: Escalate
  tiers: Record<Tier, Choice>
  types: Record<string, TypeRule>
  keywords: Record<KeywordTier, string[]>
  max_model: Model
  skip: string[]
  nested: boolean
  main_loop: MainLoop
  language: Language
}

export const RANK: Record<Model, number> = { haiku: 1, sonnet: 2, opus: 3, fable: 4 }

export const DEFAULT_KEYWORDS: Record<KeywordTier, string[]> = {
  mechanical: [
    'rename*', 'move', 'moved', 'moves', 'moving', 'format*', 'reformat*', 'typo*', 'bump*',
    're-run*', 'rerun*', 'lint*', 'sort imports', 'whitespace', 'spelling', 'version bump',
    'find and replace', 'search and replace', 'replace all', 'copyright year*', 'regenerate', 're-generate',
    'remove unused', 'unused imports',
    'переимен*', 'перенес*', 'перенеси', 'перемест*', 'отформат*', 'форматир*', 'опечат*',
    'обнови верси*', 'подними верси*', 'поменяй верси*', 'перезапус*', 'орфограф*', 'замени все',
    'перегенерир*', 'неиспользуем* импорт*',
  ],
  risky: [
    'migrat*', 'concurren*', 'race condition*', 'race', 'races', 'racy', 'data race*', 'deadlock*', 'thread*',
    'atomic*', 'idempoten*', 'mutex*', 'semaphore*', 'lock-free',
    'payment*', 'billing', 'money', 'refund*', 'invoice*', 'wallet*', 'payout*', 'purchase*',
    'security', 'vulnerab*', 'auth', 'authentic*', 'authoriz*', 'oauth', 'login', 'csrf', 'xss',
    'sql injection', 'permission*', 'access control*', 'encrypt*', 'crypto*', 'secret*', 'credential*',
    'privacy', 'gdpr', 'pii', 'personal data', 'compliance',
    'data loss', 'lose data', 'losing data', 'persist*', 'backfill*', 'drop table', 'schema change*',
    'production', 'prod', 'k8s', 'kubernetes', 'outage*', 'incident*', 'downtime', 'rollout*',
    'shared config*', 'shared layer*', 'shared module*', 'shared librar*', 'shared package*', 'shared code',
    'monorepo', 'public api', 'breaking change*', 'backward compat*', 'backwards compat*', 'regress', 'regresses', 'regressed', 'regressing',
    'root cause', 'flaky', 'intermittent*', 'sporadic*', 'non-determinis*', 'nondeterminis*', 'determinis*',
    'memory leak*', 'cache invalidation', 'cache coheren*', 'distributed',
    'engine', 'engines', 'gpu', 'gpus', 'metal', 'shader*', 'vulkan', 'cuda', 'opengl',
    'миграц*', 'мигрир*', 'оплат*', 'платеж*', 'платёж*', 'деньг*', 'кошел*к*', 'возврат* средств', 'списани*',
    'безопасность', 'уязвимость', 'авторизация', 'аутентификация', 'логин', 'залогин*',
    'приватность', 'персональные данные', 'конфиденциальность',
    'гонк*', 'конкурентн*', 'многопоточ*', 'атомарн*', 'параллельные запросы', 'идемпотентн*',
    'шифр*', 'потеря данных', 'потерять данные', 'продакшн*', 'продакшен*', 'прод', 'проде', 'прода',
    'инцидент*', 'первопричин*', 'утечк*', 'плавающ*', 'нестабильн*', 'детерминир*',
    'обратн* совместим*', 'общий слой', 'общий модуль', 'движ*к*', 'шейдер*',
  ],
  deep: [
    'architecture', 'architectural', 'system design', 'redesign*', 're-architect*',
    'big decision', 'trade-off*', 'tradeoff*', 'consistency model', 'multi-region', 'active-active',
    'architecture decision*', 'design doc',
    'архитектур*', 'проектирование системы', 'спроектир*', 'перепроектир*', 'больш* решени*', 'компромисс*',
  ],
}

const DEFAULT_TIERS: Record<Tier, Choice> = {
  search: { model: 'haiku' },
  mechanical: { model: 'sonnet', effort: 'low' },
  ordinary: { model: 'sonnet', effort: 'medium' },
  risky: { model: 'opus', effort: 'high' },
  deep: { model: 'opus', effort: 'xhigh' },
}

export const DEFAULTS: Config = {
  rules: [],
  max_effort: 'max',
  abstain: true,
  long_brief: 1500,
  escalate: {
    enabled: true,
    after: { error: 1, check: 2, transient: 2, complaint: 1 },
    protocol: true,
    window_min: 60,
    ladder: [{ model: 'haiku' }, { model: 'sonnet', effort: 'medium' }, { model: 'opus', effort: 'high' }, { model: 'opus', effort: 'xhigh' }],
  },
  tiers: DEFAULT_TIERS,
  types: {},
  keywords: DEFAULT_KEYWORDS,
  max_model: 'opus',
  skip: [],
  nested: false,
  main_loop: 'off',
  language: 'en',
}

type EscalateLayer = Partial<{
  enabled: boolean
  after: number | Partial<{ error: number; check: number; transient: number; complaint: number }>
  protocol: boolean
  window_min: number
  ladder: Choice[]
}>

type Layer = Partial<{
  preset: Preset
  rules: Rule[]
  max_effort: Effort
  abstain: boolean
  default: Choice
  long_brief: number
  escalate: EscalateLayer
  tiers: Partial<Record<Tier, Choice>>
  types: Record<string, TypeRule>
  keywords: Partial<Record<KeywordTier, string[]>>
  max_model: Model
  skip: string[]
  nested: boolean
  main_loop: MainLoop
  language: Language
}>

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(s => typeof s === 'string' && s.trim() !== '')

function checkChoice(v: unknown, where: string): string | undefined {
  if (!isObject(v)) return `${where} must be an object`
  if (!isOneOf(MODELS, v.model)) return `${where}.model must be one of ${MODELS.join(', ')}`
  if (v.effort !== undefined && !isOneOf(EFFORTS, v.effort))
    return `${where}.effort must be one of ${EFFORTS.join(', ')}`
  const extra = Object.keys(v).filter(k => k !== 'model' && k !== 'effort')
  return extra.length > 0 ? `${where} has unknown field ${extra[0]}` : undefined
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10

function checkEscalate(v: unknown): string | undefined {
  if (!isObject(v)) return 'escalate must be an object'
  const unknown = Object.keys(v).find(k => !['enabled', 'after', 'window_min', 'ladder', 'protocol'].includes(k))
  if (unknown !== undefined) return `escalate has unknown field "${unknown}"`
  if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'escalate.enabled must be true or false'
  if (v.protocol !== undefined && typeof v.protocol !== 'boolean') return 'escalate.protocol must be true or false'
  if (v.after !== undefined && !isCount(v.after)) {
    if (!isObject(v.after)) return 'escalate.after must be a number from 1 to 10 or { error, check, transient, complaint }'
    for (const [k, n] of Object.entries(v.after)) {
      if (!['error', 'check', 'transient', 'complaint'].includes(k)) return `escalate.after has unknown field "${k}"`
      if (!isCount(n)) return `escalate.after.${k} must be a number from 1 to 10`
    }
  }
  if (v.window_min !== undefined && !(typeof v.window_min === 'number' && v.window_min > 0 && v.window_min <= 1440))
    return 'escalate.window_min must be minutes, from 1 to 1440'
  if (v.ladder !== undefined) {
    if (!Array.isArray(v.ladder) || v.ladder.length < 2) return 'escalate.ladder must be a list of at least two { model, effort? }'
    for (const [i, rung] of v.ladder.entries()) {
      const bad = checkChoice(rung, `escalate.ladder[${i}]`)
      if (bad !== undefined) return bad
    }
  }
  return undefined
}

function checkRules(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length === 0) return 'rules must be a non-empty list ending with a { "default": true, … } rule'
  for (const [i, rule] of v.entries()) {
    const at = `rules[${i}]`
    if (!isObject(rule)) return `${at} must be an object`
    const isDefault = rule.default === true
    if (rule.default !== undefined && !isDefault) return `${at}.default must be true`
    if (isDefault !== (i === v.length - 1)) return isDefault ? `${at} is a default rule; only the last rule may be one` : 'rules must end with a { "default": true, … } rule'
    if (isDefault && rule.match !== undefined) return `${at} is the default and takes no match`
    if (!isDefault) {
      if (!isObject(rule.match) || Object.keys(rule.match).length === 0) return `${at}.match must name at least one of type, regex, min_chars, max_chars, paths`
      const m = rule.match
      const extra = Object.keys(m).find(k => !['type', 'regex', 'min_chars', 'max_chars', 'paths'].includes(k))
      if (extra !== undefined) return `${at}.match has unknown field "${extra}"`
      if (m.type !== undefined && typeof m.type !== 'string' && !isStringList(m.type)) return `${at}.match.type must be a type, a glob or a list of them`
      if (m.regex !== undefined) {
        if (typeof m.regex !== 'string' || m.regex === '') return `${at}.match.regex must be a regular expression`
        try {
          new RegExp(m.regex, 'iu')
        } catch {
          return `${at}.match.regex is not a valid regular expression`
        }
      }
      for (const k of ['min_chars', 'max_chars'] as const)
        if (m[k] !== undefined && !(typeof m[k] === 'number' && m[k] >= 0)) return `${at}.match.${k} must be a number of characters`
      if (m.paths !== undefined && !isStringList(m.paths)) return `${at}.match.paths must be a list of globs`
    }
    const actions = ['model', 'tier', 'auto', 'abstain'].filter(k => rule[k] !== undefined)
    if (actions.length !== 1) return `${at} must say exactly one of model, tier, auto: true, abstain: true`
    const extra = Object.keys(rule).find(k => !['match', 'default', 'name', 'model', 'effort', 'tier', 'auto', 'abstain'].includes(k))
    if (extra !== undefined) return `${at} has unknown field "${extra}"`
    if (rule.model !== undefined) {
      const bad = checkChoice({ model: rule.model, ...(rule.effort !== undefined ? { effort: rule.effort } : {}) }, at)
      if (bad !== undefined) return bad
    } else if (rule.effort !== undefined) return `${at}.effort goes with model`
    if (rule.tier !== undefined && !isOneOf(TIERS, rule.tier)) return `${at}.tier must be one of ${TIERS.join(', ')}`
    if (rule.auto !== undefined && rule.auto !== true) return `${at}.auto must be true`
    if (rule.abstain !== undefined && rule.abstain !== true) return `${at}.abstain must be true`
    if (rule.name !== undefined && typeof rule.name !== 'string') return `${at}.name must be a string`
  }
  return undefined
}

export const PRESET_LAYERS: Record<Preset, { max_model: Model; max_effort: Effort; tiers: Record<Tier, Choice> }> = {
  thrifty: {
    max_model: 'sonnet',
    max_effort: 'high',
    tiers: {
      search: { model: 'haiku' },
      mechanical: { model: 'haiku' },
      ordinary: { model: 'sonnet', effort: 'medium' },
      risky: { model: 'sonnet', effort: 'high' },
      deep: { model: 'sonnet', effort: 'high' },
    },
  },
  balanced: { max_model: 'opus', max_effort: 'xhigh', tiers: DEFAULT_TIERS },
  strict: {
    max_model: 'opus',
    max_effort: 'max',
    tiers: {
      search: { model: 'haiku' },
      mechanical: { model: 'sonnet', effort: 'medium' },
      ordinary: { model: 'sonnet', effort: 'high' },
      risky: { model: 'opus', effort: 'high' },
      deep: { model: 'opus', effort: 'max' },
    },
  },
}

export function validate(raw: unknown): { layer: Layer } | { error: string } {
  if (!isObject(raw)) return { error: 'the file must hold a JSON object' }
  const known = ['preset', 'rules', 'max_effort', 'abstain', 'default', 'long_brief', 'escalate', 'tiers', 'types', 'keywords', 'max_model', 'skip', 'nested', 'main_loop', 'language', '$schema', 'comment']
  const unknown = Object.keys(raw).find(k => !known.includes(k))
  if (unknown !== undefined) return { error: `unknown field "${unknown}"` }

  if (raw.preset !== undefined && !isOneOf(PRESETS, raw.preset)) return { error: `preset must be one of ${PRESETS.join(', ')}` }
  if (raw.max_effort !== undefined && !isOneOf(EFFORTS, raw.max_effort)) return { error: `max_effort must be one of ${EFFORTS.join(', ')}` }
  if (raw.rules !== undefined) {
    const bad = checkRules(raw.rules)
    if (bad !== undefined) return { error: bad }
  }
  if (raw.abstain !== undefined && typeof raw.abstain !== 'boolean') return { error: 'abstain must be true or false' }
  if (raw.default !== undefined) {
    const bad = checkChoice(raw.default, 'default')
    if (bad !== undefined) return { error: bad }
  }
  if (raw.long_brief !== undefined && !(typeof raw.long_brief === 'number' && raw.long_brief >= 100 && raw.long_brief <= 100_000))
    return { error: 'long_brief must be a number of characters, from 100 to 100000' }
  if (raw.escalate !== undefined) {
    const bad = checkEscalate(raw.escalate)
    if (bad !== undefined) return { error: bad }
  }
  if (raw.tiers !== undefined) {
    if (!isObject(raw.tiers)) return { error: 'tiers must be an object' }
    for (const [name, choice] of Object.entries(raw.tiers)) {
      if (!isOneOf(TIERS, name)) return { error: `tiers.${name} is not a tier (${TIERS.join(', ')})` }
      const bad = checkChoice(choice, `tiers.${name}`)
      if (bad !== undefined) return { error: bad }
    }
  }
  if (raw.types !== undefined) {
    if (!isObject(raw.types)) return { error: 'types must be an object' }
    for (const [name, rule] of Object.entries(raw.types)) {
      if (isObject(rule) && 'tier' in rule) {
        if (!isOneOf(TIERS, rule.tier) || Object.keys(rule).length !== 1)
          return { error: `types.${name}.tier must be one of ${TIERS.join(', ')}` }
        continue
      }
      const bad = checkChoice(rule, `types.${name}`)
      if (bad !== undefined) return { error: bad }
    }
  }
  if (raw.keywords !== undefined) {
    if (!isObject(raw.keywords)) return { error: 'keywords must be an object' }
    for (const [name, words] of Object.entries(raw.keywords)) {
      if (!isOneOf(KEYWORD_TIERS, name))
        return { error: `keywords.${name} is not a keyword tier (${KEYWORD_TIERS.join(', ')})` }
      if (!isStringList(words)) return { error: `keywords.${name} must be a list of non-empty strings` }
    }
  }
  if (raw.max_model !== undefined && !isOneOf(MODELS, raw.max_model))
    return { error: `max_model must be one of ${MODELS.join(', ')}` }
  if (raw.skip !== undefined && !isStringList(raw.skip)) return { error: 'skip must be a list of agent types' }
  if (raw.nested !== undefined && typeof raw.nested !== 'boolean') return { error: 'nested must be true or false' }
  if (raw.main_loop !== undefined && !isOneOf(MAIN_LOOP, raw.main_loop))
    return { error: `main_loop must be one of ${MAIN_LOOP.join(', ')}` }
  if (raw.language !== undefined && raw.language !== 'en' && raw.language !== 'ru')
    return { error: 'language must be "en" or "ru"' }
  return { layer: raw as Layer }
}

export function merge(base: Config, layer: Layer): Config {
  const preset = layer.preset !== undefined ? PRESET_LAYERS[layer.preset] : undefined
  if (preset !== undefined) base = { ...base, preset: layer.preset, max_model: preset.max_model, max_effort: preset.max_effort, tiers: preset.tiers }
  const keywords = { ...base.keywords }
  for (const tier of KEYWORD_TIERS) {
    const extra = layer.keywords?.[tier]
    if (extra !== undefined) keywords[tier] = [...keywords[tier], ...extra.map(w => w.toLowerCase())]
  }
  const e = layer.escalate
  const after =
    typeof e?.after === 'number' ? { ...base.escalate.after, error: e.after, check: e.after } : { ...base.escalate.after, ...(e?.after ?? {}) }
  const out: Config = {
    rules: layer.rules ?? base.rules,
    max_effort: layer.max_effort ?? base.max_effort,
    abstain: layer.abstain ?? base.abstain,
    long_brief: layer.long_brief ?? base.long_brief,
    escalate: {
      enabled: e?.enabled ?? base.escalate.enabled,
      protocol: e?.protocol ?? base.escalate.protocol,
      after,
      window_min: e?.window_min ?? base.escalate.window_min,
      ladder: e?.ladder ?? base.escalate.ladder,
    },
    tiers: { ...base.tiers, ...layer.tiers },
    types: { ...base.types, ...layer.types },
    keywords,
    max_model: layer.max_model ?? base.max_model,
    skip: [...base.skip, ...(layer.skip ?? [])],
    nested: layer.nested ?? base.nested,
    main_loop: layer.main_loop ?? base.main_loop,
    language: layer.language ?? base.language,
  }
  if (base.preset !== undefined) out.preset = base.preset
  const fallback = layer.default ?? base.default
  if (fallback !== undefined) out.default = fallback
  return out
}
