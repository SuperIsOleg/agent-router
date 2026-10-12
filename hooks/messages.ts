import type { Language, Model, Tier } from './config'
import type { Labels } from './policy'

export type Texts = {
  labels: Labels
  toast: (type: string, model: string, effort: string | undefined, why: string) => string
  badConfig: (path: string, reason: string) => string
  askAbove: (type: string, model: string, cap: Model, why: string) => string
  allowAnyway: (model: string) => string
  useCap: (cap: Model) => string
  cancel: string
  deniedByUser: (model: string) => string
  deniedNoOne: (model: string, cap: Model) => string
  failedOpen: (reason: string) => string
  routeTitle: (day: string) => string
  routeNone: (day: string) => string
  routeTotal: (count: number, auto: number, byModel: string) => string
  mainLoop: (model: string, effort: string | undefined, why: string) => string
  retryWhy: (prev: string, cause: string) => string
  escalated: (type: string, to: string, prev: string, cause: string) => string
  raisedCaller: (asked: string) => string
  needsPerson: (model: string, cause: string) => string
  routeEscalated: (from: string, to: string, cause: string) => string
  routeTop: (at: string, cause: string) => string
  routeEscalations: (count: number) => string
  routeCost: (cost: string, main: string) => string
  retrying: (type: string, at: string, cause: string) => string
  retryOnRungWhy: (at: string, cause: string) => string
  stopped: (type: string, cause: string) => string
  refused: (type: string, cause: string) => string
  protocol: string
  carry: (prev: string, cause: string) => string
  carrySignal: (prev: string, reason: string) => string
  carryOverflow: (prev: string) => string
  complaint: string
  stayWhy: (at: string) => string
  routeRates: (off: number, escalated: number, abstained: number) => string
  routeSaved: (cost: string, main: string, saved: string, pct: number, known: number, total: number) => string
}

const tierEn: Record<Tier, string> = {
  search: 'search',
  mechanical: 'mechanical',
  ordinary: 'ordinary',
  risky: 'risky',
  deep: 'deep',
}

const tierRu: Record<Tier, string> = {
  search: 'поиск',
  mechanical: 'механика',
  ordinary: 'обычная',
  risky: 'риск',
  deep: 'глубокая',
}

const en: Texts = {
  labels: {
    auto: 'auto',
    role: {
      search: 'read-only search',
      plan: 'planning',
      review: 'review',
      write: 'code change',
      unknown: 'unknown type, middle default',
    },
    keyword: (word, tier) => `"${word}" → ${tierEn[tier]}`,
    configType: type => `config types.${type}`,
    ownModel: "agent's own model",
    unknownModel: 'model left to the agent definition',
    callerModel: 'model as the caller set it',
    capped: cap => `capped at ${cap}`,
    abstain: why => `abstain (${why})`,
    abstainWhy: {
      mixed: word => `"${word}" against a cheap cue, too close to call`,
      'no-signal': 'unknown type, no signal',
      vague: 'brief too short to judge',
      backref: 'refers to an earlier context',
    },
    longBrief: 'long brief, not haiku',
    projectDefault: 'project default',
    rule: name => `rule ${name}`,
    effortCapped: cap => `effort capped at ${cap}`,
  },
  toast: (type, model, effort, why) => `${type} → ${model}${effort ? ` ${effort}` : ''} (${why})`,
  badConfig: (path, reason) => `agent-router: ${path} is invalid (${reason}); using the defaults.`,
  askAbove: (type, model, cap, why) =>
    `Spawn ${type} on ${model}? It is above the cap (${cap})${model === 'fable' ? ', about 2.5× the price of opus' : ''}. Reason: ${why || 'none given'}`,
  allowAnyway: model => `Run on ${model}`,
  useCap: cap => `Use ${cap}`,
  cancel: 'Cancel the spawn',
  deniedByUser: model => `agent-router: the person declined ${model} for this spawn. Re-spawn on a lower model, or ask them first.`,
  deniedNoOne: (model, cap) =>
    `agent-router: ${model} is above max_model (${cap}) and nobody could confirm it here. Pass model "${cap}" or lower, or raise max_model in .claude/agent-router.json.`,
  failedOpen: reason => `agent-router: left the call unchanged (${reason})`,
  routeTitle: day => `spawns on ${day}:`,
  routeNone: day => `no spawns recorded on ${day}.`,
  routeTotal: (count, auto, byModel) => `Total: ${count} spawns, ${auto} routed automatically. By model: ${byModel}.`,
  mainLoop: (model, effort, why) => `main loop → ${model}${effort ? ` ${effort}` : ''} (${why})`,
  retryWhy: (prev, cause) => `retry after a failure on ${prev} (${cause})`,
  escalated: (type, to, prev, cause) => `agent-router: retrying ${type} on ${to} after a failure on ${prev} (${cause})`,
  raisedCaller: asked => ` — raised from ${asked}, which the call asked for`,
  needsPerson: (model, cause) => `agent-router: the task failed again on ${model} — needs a person (${cause})`,
  routeEscalated: (from, to, cause) => `    ↑ ${from} → ${to} (${cause})`,
  routeTop: (at, cause) => `    ! failed again on ${at}, needs a person (${cause})`,
  routeEscalations: count => `Escalations: ${count}.`,
  routeCost: (cost, main) => `≈${cost} (≈${main} on the main model)`,
  retrying: (type, at, cause) => `agent-router: retrying ${type} once more on ${at} (${cause})`,
  retryOnRungWhy: (at, cause) => `retry on the same rung ${at} (${cause})`,
  stopped: (type, cause) => `agent-router: the last ${type} run was refused (${cause}) — not retrying or escalating; ask the person`,
  refused: (type, cause) => `agent-router: ${type} refused the task (${cause}) — no retry, no escalation`,
  protocol: 'If you cannot finish this reliably, reply with one line `ESCALATE: <reason>` and stop.',
  carry: (prev, cause) => `The previous attempt on ${prev} failed: ${cause}`,
  carrySignal: (prev, reason) => `The previous attempt on ${prev} asked to escalate: ${reason}`,
  carryOverflow: prev => `The previous attempt on ${prev} ran out of context: read less (entry points, public interfaces), summarise as you go.`,
  complaint: 'the person says it still does not work',
  stayWhy: at => `kept on ${at}, where this task last succeeded after an escalation`,
  routeRates: (off, escalated, abstained) => `Kept off the main model: ${off}%. Escalation rate: ${escalated}%. Abstain rate: ${abstained}%.`,
  routeSaved: (cost, main, saved, pct, known, total) =>
    `Estimated cost: ≈${cost} against ≈${main} on the main model — saved ≈${saved} (${pct}%). Estimate: token counts × list prices, for ${known} of ${total} spawns with known usage.`,
}

const ru: Texts = {
  labels: {
    auto: 'авто',
    role: {
      search: 'поиск без правок',
      plan: 'планирование',
      review: 'ревью',
      write: 'правка кода',
      unknown: 'тип неизвестен, средний выбор',
    },
    keyword: (word, tier) => `«${word}» → ${tierRu[tier]}`,
    configType: type => `конфиг types.${type}`,
    ownModel: 'своя модель агента',
    unknownModel: 'модель решает определение агента',
    callerModel: 'модель задал вызов',
    capped: cap => `не выше ${cap}`,
    abstain: why => `не выбираю (${why})`,
    abstainWhy: {
      mixed: word => `«${word}» против признака простой задачи, слишком близко`,
      'no-signal': 'тип неизвестен, признаков нет',
      vague: 'бриф слишком короткий',
      backref: 'ссылается на прошлый контекст',
    },
    longBrief: 'длинный бриф, не haiku',
    projectDefault: 'выбор проекта по умолчанию',
    rule: name => `правило ${name}`,
    effortCapped: cap => `усилие не выше ${cap}`,
  },
  toast: (type, model, effort, why) => `${type} → ${model}${effort ? ` ${effort}` : ''} (${why})`,
  badConfig: (path, reason) => `agent-router: ${path} с ошибкой (${reason}); беру настройки по умолчанию.`,
  askAbove: (type, model, cap, why) =>
    `Запустить ${type} на ${model}? Это выше предела (${cap})${model === 'fable' ? ', примерно в 2,5 раза дороже opus' : ''}. Причина: ${why || 'не указана'}`,
  allowAnyway: model => `Запустить на ${model}`,
  useCap: cap => `Взять ${cap}`,
  cancel: 'Отменить запуск',
  deniedByUser: model => `agent-router: человек отклонил ${model} для этого запуска. Запусти на модели ниже или сначала спроси его.`,
  deniedNoOne: (model, cap) =>
    `agent-router: ${model} выше max_model (${cap}), и подтвердить некому. Передай model "${cap}" или ниже либо подними max_model в .claude/agent-router.json.`,
  failedOpen: reason => `agent-router: вызов оставлен как есть (${reason})`,
  routeTitle: day => `запуски за ${day}:`,
  routeNone: day => `за ${day} запусков нет.`,
  routeTotal: (count, auto, byModel) => `Всего: ${count}, из них автоматически: ${auto}. По моделям: ${byModel}.`,
  mainLoop: (model, effort, why) => `основной цикл → ${model}${effort ? ` ${effort}` : ''} (${why})`,
  retryWhy: (prev, cause) => `повтор после неудачи на ${prev} (${cause})`,
  escalated: (type, to, prev, cause) => `agent-router: повторяю ${type} на ${to} после неудачи на ${prev} (${cause})`,
  raisedCaller: asked => ` — поднял с ${asked}, которую задал вызов`,
  needsPerson: (model, cause) => `agent-router: задача снова не прошла на ${model} — нужен человек (${cause})`,
  routeEscalated: (from, to, cause) => `    ↑ ${from} → ${to} (${cause})`,
  routeTop: (at, cause) => `    ! снова не прошла на ${at}, нужен человек (${cause})`,
  routeEscalations: count => `Повышений: ${count}.`,
  routeCost: (cost, main) => `≈${cost} (≈${main} на основной модели)`,
  retrying: (type, at, cause) => `agent-router: повторяю ${type} ещё раз на ${at} (${cause})`,
  retryOnRungWhy: (at, cause) => `повтор на той же ступени ${at} (${cause})`,
  stopped: (type, cause) => `agent-router: прошлый запуск ${type} отказал (${cause}) — не повторяю и не повышаю; спроси человека`,
  refused: (type, cause) => `agent-router: ${type} отказался от задачи (${cause}) — без повтора и повышения`,
  protocol: 'Если не можешь надёжно закончить, ответь одной строкой `ESCALATE: <причина>` и остановись.',
  carry: (prev, cause) => `Прошлая попытка на ${prev} не удалась: ${cause}`,
  carrySignal: (prev, reason) => `Прошлая попытка на ${prev} попросила повышения: ${reason}`,
  carryOverflow: prev => `Прошлой попытке на ${prev} не хватило контекста: читай меньше (точки входа, публичные интерфейсы), подводи итоги по ходу.`,
  complaint: 'человек говорит, что всё ещё не работает',
  stayWhy: at => `оставляю ${at}: здесь задача прошла после повышения`,
  routeRates: (off, escalated, abstained) => `Не на основной модели: ${off}%. Повышений: ${escalated}%. Без выбора: ${abstained}%.`,
  routeSaved: (cost, main, saved, pct, known, total) =>
    `Оценка стоимости: ≈${cost} против ≈${main} на основной модели — сэкономлено ≈${saved} (${pct}%). Оценка: токены × цены прайса, для ${known} из ${total} запусков с известным расходом.`,
}

export function texts(language: Language): Texts {
  return language === 'ru' ? ru : en
}
