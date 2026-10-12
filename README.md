# agent-router

A Claude Code plugin that gives every subagent spawn a model and a reasoning effort that fit the task, so you stop paying Opus prices for a file search and stop running risky work on a cheap model.

It works only with **Claude Code** (CLI, desktop Code tab, IDE extensions). It does not work with other agents or with the plain Claude apps.

[Русская версия ниже](#agent-router-по-русски)

## What's new in 0.2.0

- **Real savings.** Every spawn logs its tokens and an estimated cost, the requested and the resolved model, and what the same tokens would have cost on the main session's model. `/router` shows the estimated saving, the share kept off the main model, the escalation rate and the abstain rate.
- **Abstain.** When nothing in the brief says what kind of task it is, or the signals contradict each other, the router keeps the agent's own model and effort (or the project `default`) and says so: `route: opus — auto: abstain (brief too short to judge)`. It never guesses the cheapest tier.
- **Escalation by error type.** A context overflow or an `ESCALATE:` reply goes up at once; a refusal is never retried or escalated, only shown; a timeout gets one retry on the same rung; a failed check goes up after two, an error after one; right after an escalation a task gets one retry before it can move again. A cheap-tier agent is told it may answer `ESCALATE: <reason>`, and the reason reaches the next rung. «Ещё раз», “still failing” in a new spawn of the same task counts as a failure of the last one.
- **Rules and presets.** An ordered `rules` list in the config matches by agent type, regex, prompt length or path globs; the first match wins and the last rule must be the default. A `preset` (`thrifty`, `balanced`, `strict`) moves the model and effort ceilings together.
- **`scripts/calibrate.mjs`** reads the spawn log offline and proposes keywords, a `long_brief` threshold and a target share of the strong model. It never writes the config.
- **Only the typed text is scored.** Fenced code, indented blocks, diffs, stack traces, log lines, quotes and tool output are dropped before keyword matching; identifiers, paths and quoted strings count only as weak evidence. Negations (“don't touch payments”, «не трогай оплату») no longer raise the tier, while a negated risk (“users must not lose data”) still does. Russian keywords match their word forms. A long, detailed brief never lands on haiku.

## Why

Most of a long agent session's cost is **context re-read on every step**, not output. In one measured session (about $393 at list price), 63% went to a single engineer agent on Opus, and two runs grew to about 900k tokens of context. So the router does two things:

1. picks a cheaper model and a lower effort whenever the task allows it;
2. tells Claude to keep runs short and hand off to a fresh agent with a written note instead of resuming a huge one.

## What is inside

| Part | What it does |
|---|---|
| Skill `agent-router:route` | Short rules Claude follows before every Agent spawn: classify the task, pick model and effort, write the route line, hand off past ~300k context, escalate one step after two failed checks, batch mechanical edits, set the check depth by risk. Generic: any project, any language, any kind of work. |
| Function hooks (safety net) | Run on every Agent call even when the skill was never invoked: route it, write `model` and `effort` into the call, prepend a route line, enforce the cap, escalate a retry of a failed task, record it. |
| `/router` | Shows today's spawns and their total. |
| Optional config | `.claude/agent-router.json` in the project, or `~/.claude/agent-router.json`. |

With **zero setup** — no agents of your own, no config, no other plugins — a plain session in which Claude decides to spawn `general-purpose`, `Explore`, `Plan` or an Agent call with no `subagent_type` is routed by the defaults below.

## Requirements

- Claude Code **2.1.293 or newer**. Function hooks are early access; the test kit and the hook API used here were verified on 2.1.293. On 2.1.282 the plugin validates and 111 of 112 tests pass (that kit does not raise the PreToolUse layer the remaining test checks), so treat older builds as unverified.
- No extra setting is needed: a plugin loaded with `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS` runs its hooks (checked in a fresh `HOME` with `claude -p`). If your organization disables plugins or function hooks by policy, nothing loads.

## Install

The simplest way: in a Claude Code session, add this repo as a plugin marketplace and install from it. Updates come with `/plugin marketplace update`.

```
/plugin marketplace add oleg-kalistratov/agent-router
/plugin install agent-router@agent-router
```

Or from a clone:

```sh
git clone https://github.com/oleg-kalistratov/agent-router.git ~/agent-router
claude --plugin-dir ~/agent-router            # one session
```

or for every session, put the folder in `CLAUDE_CODE_PLUGIN_DIRS` (an absolute path; several are separated by `:`), either in your shell profile or in the `env` block of `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/agent-router" } }
```


## How it chooses

For an Agent call the hooks do, in order:

1. **Leave it alone** when the call sets `isolation`, comes from inside a subagent (unless `"nested": true`), or its type matches `skip`.
2. **Respect an explicit route.** A prompt that has a `route: <model> <effort> — <why>` line keeps it. A missing `model` or `effort` is filled from that line; nothing else changes.
3. **Rules.** The first rule in `rules` that matches decides: a `tier`, a forced `model`, `abstain`, or `auto` (go on below). See [Rules](#rules).
4. **Otherwise route it automatically:**
   - the **role** of the agent type: from its definition when it can be read (project `.claude/agents/<name>.md`, `~/.claude/agents/<name>.md`, or `agents/<name>.md` in a plugin folder from `CLAUDE_CODE_PLUGIN_DIRS` or the installed plugins) — a definition whose `tools` has no Edit/Write is read-only; then from its description (read-only / search / plan / review / writes code); built-in `Explore` and `claude-code-guide` are search, `Plan` is planning, `general-purpose` and a call with no type are code changes; anything else is unknown;
   - an unknown type's **name** is a weak role hint (`docs-writer` writes, `code-reviewer` reviews, `data-analyst` analyses);
   - only the **typed text** of the `description` and `prompt` is read: fenced code, indented blocks, diffs, stack traces, log lines, `>` quotes and tool output are dropped; inline code, paths, identifiers and quoted strings are kept aside as weak evidence; a phrase the brief rules out (“don't touch X”, “without changing X”, «не трогай X», «без правок в X») is masked up to the end of its clause, while a negated risk (“must not lose data”, «не должны потерять данные») stays;
   - **keywords** in that text: a risky or deep word raises the tier; one weak hit (an identifier like `PaymentSheetView`, or a risky word that only names a screen or a button) does not, two do; a mechanical word lowers the tier only when it is in the description or the first line, so a passing "format" deep in a brief does not cheapen a real task; Russian dictionary forms match their inflections (`миграция` → миграцию, миграции; `потеря данных` → потерять данные; `безопасность` but not безопасно);
   - a brief that only finds, lists or counts (and asks for no change or explanation) goes to the search tier even on `general-purpose`;
   - **abstain** when the call cannot be judged: an unknown type with no signal, a brief under four words, a brief that refers to an earlier context (“same as last time”, «как в прошлый раз»), or a risky word only in the body against a cheap cue (a mechanical title, “just add …”, “nothing else”). The call keeps the agent's own model and effort, or the project `default`, and the route line says `auto: abstain (<why>)`;
   - **a long brief is not haiku**: when the chosen tier runs on haiku and the typed brief is at least `long_brief` characters (1500), it moves to the mechanical tier (or ordinary, if mechanical is haiku too);
   - the tier gives the model and effort, clamped to `max_model`;
   - `model` and `effort` are written into the call and `route: <model> <effort> — auto: <reason>` is prepended to the prompt;
   - one short toast says what was chosen, and a line goes to the debug log.
5. **A model the agent chose for itself is kept.** If an agent's definition names its own model (or the router saw on an earlier spawn that the type resolves to a model other than its parent's), only the effort is set. A plugin agent whose definition cannot be read keeps its model on the first spawn; the router learns from that spawn.
6. **Cap.** A call that asks for a model above `max_model`, and every `fable` call, opens the native question dialog with the reason: run it anyway, use the cap, or cancel. With nobody to ask (`claude -p`) the call is denied with a message that says what to pass instead.
7. **Fail open.** Any error leaves the call exactly as it was.

### Default table

| Tier | When | Model | Effort |
|---|---|---|---|
| search | read-only agents (Explore, claude-code-guide, definitions without write tools) | haiku | — |
| mechanical | rename, move, format, typo, bump, re-run, lint… (EN and RU) | sonnet | low |
| ordinary | everything else, plans and reviews; unknown types | sonnet | medium |
| risky | migration, concurrency, race, payment, money, security, auth, permissions, encryption, secrets, persistence, production, root cause, flaky, memory leak, engine… (EN and RU) | opus | high |
| deep | architecture, system design, redesign, trade-off, big decision (EN and RU) | opus | xhigh |

A read-only agent with a risky word goes to `ordinary`, not higher. Plans and reviews go up with risky or deep words.

### Prices (per million tokens, input / output)

| Model | Input | Output |
|---|---|---|
| haiku | $1 | $5 |
| sonnet | $2 | $10 |
| opus | $4 | $20 |
| fable | $10 | $50 |

Reasoning effort is `low`, `medium`, `high`, `xhigh` or `max`; haiku has none.

## Config

Optional. The project file wins over the user file, which wins over the defaults:

1. `<project>/.claude/agent-router.json`
2. `~/.claude/agent-router.json` (or `$CLAUDE_CONFIG_DIR/agent-router.json`)

| Field | Type | Default | Meaning |
|---|---|---|---|
| `tiers` | `{ search \| mechanical \| ordinary \| risky \| deep: { model, effort? } }` | table above | What each tier runs on. |
| `types` | `{ "<subagent_type or glob>": { model, effort? } \| { tier } }` | `{}` | Per-type override. `{ model }` forces the model even over an agent's own; `{ tier }` picks the tier and keeps the rest of the logic. |
| `keywords` | `{ mechanical \| risky \| deep: string[] }` | built-in EN + RU lists | Extra words, added to the built-in ones. A word matches whole; `*` matches any letters (`migrat*`, `миграц*`). |
| `max_model` | `haiku \| sonnet \| opus \| fable` | `opus` | Never route above it automatically; an explicit call above it asks. `fable` always asks. |
| `skip` | `string[]` of types or globs | `[]` | Types the router never touches. |
| `nested` | `boolean` | `false` | Also route spawns made from inside a subagent. |
| `main_loop` | `off \| effort \| model` | `off` | See below. |
| `language` | `en \| ru` | `en` | Language of toasts, questions, denials, `/router` and the route reason. |
| `escalate` | `{ enabled, after, window_min, ladder }` | on, `{ error: 1, check: 2 }`, 60, haiku → sonnet medium → opus high → opus xhigh | Retry of a failed task one rung up. See below. |
| `preset` | `thrifty \| balanced \| strict` | none (= balanced) | Sets `max_model`, `max_effort` and `tiers` together; fields in the same file still override it. See [Presets](#presets). |
| `max_effort` | `low … max` | `max` | Never route above this effort automatically; also caps the escalation ladder. |
| `rules` | ordered list | `[]` | First match wins; the last rule must be `{ "default": true, … }`. See [Rules](#rules). |
| `abstain` | `boolean` | `true` | Keep the agent's own model and effort when the brief gives no signal or contradicting ones. `false` falls back to the middle default. |
| `default` | `{ model, effort? }` | none | What an abstained call runs on instead of the agent's own default. |
| `long_brief` | characters | `1500` | A typed brief at least this long never lands on haiku. |

A file that is not valid JSON or breaks the schema is ignored as a whole: the defaults are used and one warning is shown.

Examples:

```json
{
  "max_model": "sonnet",
  "language": "ru"
}
```

```json
{
  "tiers": { "mechanical": { "model": "haiku" } },
  "types": {
    "my-team:reviewer": { "model": "sonnet", "effort": "high" },
    "my-team:*": { "tier": "ordinary" }
  },
  "keywords": { "risky": ["ledger", "invoice*", "сверк*"] },
  "skip": ["legacy-bot"]
}
```

### Rules

`rules` is an ordered list. Each rule has a `match` and one action; the first rule whose `match` holds decides, and the list must end with a default rule. All conditions in one `match` must hold.

| `match` field | Holds when |
|---|---|
| `type` | the agent type matches the name or glob (or one of a list) |
| `regex` | the description or the prompt matches (case-insensitive) |
| `min_chars` / `max_chars` | the prompt (without the route line) is at least / at most this long |
| `paths` | a path named in the brief matches a glob (`**` crosses folders, `*` does not) |

| Action | Effect |
|---|---|
| `"tier": "risky"` | use that tier; the agent's own model and the cap still apply |
| `"model": "opus", "effort": "high"` | force this model and effort, even over the agent's own model |
| `"abstain": true` | keep the agent's own model and effort (or `default`) |
| `"auto": true` | no decision: go on to `types` and the automatic choice |

```json
{ "rules": [
  { "name": "payments", "match": { "paths": ["src/payments/**"] }, "tier": "risky" },
  { "name": "huge briefs", "match": { "min_chars": 8000 }, "model": "opus", "effort": "high" },
  { "name": "release bot", "match": { "type": "ops:release*" }, "abstain": true },
  { "default": true, "auto": true }
] }
```

The route line names the rule: `route: opus high — auto: rule payments`. A list without a default, a default that is not last, an empty `match`, a bad regex or two actions in one rule makes the whole file invalid (the defaults are used and one warning says why).

### Presets

| Preset | `max_model` | `max_effort` | search / mechanical / ordinary / risky / deep |
|---|---|---|---|
| `thrifty` | sonnet | high | haiku / haiku / sonnet medium / sonnet high / sonnet high |
| `balanced` (the default) | opus | xhigh | haiku / sonnet low / sonnet medium / opus high / opus xhigh |
| `strict` | opus | max | haiku / sonnet medium / sonnet high / opus high / opus max |

`thrifty` never reaches opus, so risky work runs on sonnet: on the bench it costs about half of all-opus but under-routes a third of the tasks. Use it only where risky work does not go through subagents.

### Calibrate

```sh
node scripts/calibrate.mjs                      # reads the spawn logs in the plugin data folder
node scripts/calibrate.mjs log.jsonl --config .claude/agent-router.json --json
```

It joins each spawn with its outcome and usage lines and proposes: risky keywords (words common to cheap-tier spawns that failed and were escalated, rare among those that passed, not yet in the lists), a `long_brief` threshold (when long haiku briefs fail much more often than short ones), a target share of spawns on the strong model, and a `default` when more than a quarter of the spawns abstain. It prints proposals only and writes nothing. On a log replayed from the bench (`node bench/run.mjs --log out.jsonl`) with the default config it proposes no change (strong share 46%, 13% of cheap spawns escalated); with `thrifty` it proposes three keywords and raising the strong share from 29% to 49%.

### The main loop (`main_loop`, off by default)

The hook API can change the model and the effort of each main-loop model request (`turn.step`). With `"main_loop": "effort"` the router sets the effort of each turn from the words of your prompt (mechanical → low, risky → high, …). With `"main_loop": "model"` it may also **lower** the model for that turn; it never raises it above the model you picked or above `max_model`. It is off by default because switching the model mid-conversation invalidates the prompt cache, and on a long conversation one cache miss can cost more than the cheaper model saves.

## Escalation after a failure

The hooks remember the last 50 routed spawns of the session (type, a normalized description, a fingerprint of the first 500 characters of the prompt without the route line, model, effort, outcome, time) and judge each one when it ends. A background agent is judged by its own final turn, a foreground one by the tool's result. The outcome is one of:

| Outcome | How it is recognised | What the next spawn of the same task gets |
|---|---|---|
| **context overflow** | an error or a report about the context limit, a too-long prompt, truncated output | one rung up at once, with a note to read less |
| **ESCALATE** | a line `ESCALATE: <reason>` in the report | one rung up at once, with the reason in the new prompt |
| **refusal** | a refused turn, or a report that opens with “I can't help with …” / «Не могу помочь…» | no retry, no escalation: a notice when it happens and again if the task is spawned again |
| **transient** | an error that is a timeout, a rate limit, an overload, a dropped connection | one retry on the same rung, then one rung up |
| **failed check** | `status: failed` / `status: blocked`, or a failure phrase in the last 600 characters (tests failed, `testX fails`, 1 failure, still failing, not green, could not fix, не прошли, упал, не удалось, всё ещё не работает…); a log quoted earlier does not count | a retry on the same rung, one rung up after the second |
| **error** | any other error: a crash, max turns, an API error | one rung up |
| **user retry** | the next spawn of the task says «ещё раз», «опять», «всё ещё не работает», “try again”, “still failing” (an identical re-send does not count) | the last attempt counts as failed: one rung up |

Rules around it:

- the **same task** is the same `subagent_type` and the same normalized description, or a prompt at least 80% similar; a user retry also matches the last spawn of the type when the prompts share a quarter of their trigrams;
- counts are kept per rung and reset after a success; three failures of any mix on one rung also move it up;
- a **retry** runs on the rung that failed, not on a fresh guess, and carries the failure into the prompt (`The previous attempt on sonnet medium failed: …`);
- **cooldown**: right after an escalation, one more error, failed check, timeout or complaint on the new rung is retried there before the task moves up again, so a task is never bounced twice in a row (ESCALATE and context overflow are not held back);
- after a task **succeeded on a raised rung**, its next spawn stays there (`kept on opus high, where this task last succeeded after an escalation`);
- the ladder is haiku → sonnet medium → opus high → opus xhigh, never above `max_model` and never to fable;
- the route line becomes `route: opus high — auto: retry after a failure on sonnet medium (<cause>)`, and one line tells you;
- a caller's explicit model that is already higher is kept; a lower one is raised, and the notice says so;
- when the top allowed rung fails again, nothing is raised: the call runs on that rung and you see «the task failed again on opus xhigh — needs a person (<cause>)».

**ESCALATE protocol.** A spawn the router puts below opus gets a second line under its route line: “If you cannot finish this reliably, reply with one line `ESCALATE: <reason>` and stop.” The router treats that reply as a failure and passes the reason to the next rung. Turn it off with `"escalate": { "protocol": false }`.

`/router` lists each escalation under its spawn (`↑ sonnet medium → opus high (tests failed)`) and counts them.

```json
{ "escalate": { "enabled": true, "protocol": true, "window_min": 60,
  "after": { "error": 1, "check": 2, "transient": 2, "complaint": 1 },
  "ladder": [ { "model": "haiku" }, { "model": "sonnet", "effort": "medium" },
              { "model": "opus", "effort": "high" }, { "model": "opus", "effort": "xhigh" } ] } }
```

`after` also takes one number for errors and failed checks (`"after": 1`).

## `/router`

Type `/router` to see today's spawns:

```
spawns on 2026-10-09:
14:02  Explore  haiku  auto  auto: read-only search
14:05  general-purpose  opus high  explicit  shared layer
Total: 2 spawns, 1 routed automatically. By model: haiku 1, opus 1.
```

With usage known, each row also shows `≈$0.030 (≈$0.120 on the main model)`, and the footer adds:

```
Kept off the main model: 50%. Escalation rate: 0%. Abstain rate: 50%.
Estimated cost: ≈$0.150 against ≈$0.240 on the main model — saved ≈$0.090 (38%). Estimate: token counts × list prices, for 2 of 2 spawns with known usage.
```

Each spawn is one JSON line in `~/.claude/plugins/data/agent-router/spawns-<date>.jsonl` (or `$CLAUDE_PLUGIN_DATA`): `at`, `id`, `type`, `model`, `effort`, `mode` (`auto`, `abstain`, `explicit`, `filled`, `escalated`, `untouched`, `denied`), `reason`, `requested` (`{ model, effort }` the call asked for), `main` (the session's model), `description`, `nested`.

When the spawn ends, a second line with `"kind": "usage"` and the same `id` records its tokens (`input`, `output`, `cache_read`, `cache_write`), the model that ran, `cost` at that model's list price and `cost_main` at the main model's. Tokens come from the subagent's own `turn.complete` (all its requests summed) when it raised one, otherwise from the Agent result's `usage`. Costs are **estimates**: list prices, cache reads at 0.1× and cache writes at 1.25× the input price, and the main-model figure assumes the same tokens, which a different model would not spend exactly.

## Working with other plugins

- **agent-office.** The route line format `route: <model> <effort> — <why>` is the one the agent-office mod parses, so its card shows the route of every spawn, the automatic ones included (`— auto: …`).
- **Plugins that check the route line in a PreToolUse hook.** Claude Code runs function hooks (`tool.call`) above every PreToolUse command hook, so such a hook already sees the routed call with its route line, `model` and `effort`, which agree with each other. If that plugin wants to *force* its users to route by hand, add its types to `skip`.

## Known limits

- The hooks can only see the agent's description and its definition file; they guess the task from words. A deliberate route from the skill is better.
- A plugin agent whose definition file cannot be found keeps its own model on its first spawn; from the second one the router knows whether the type has its own model. A type whose own model equals its parent's is taken as inheriting.
- Keyword lists are short on purpose. Extend them in the config for your domain.
- Costs in the log are estimates from token counts and list prices; the main-model figure assumes the same tokens. A spawn whose usage never arrives (a crash) has no cost line.
- Abstain keeps the agent's default, which in a session on opus is opus: safe, not cheap. Set `default` if you want abstained calls on something else.
- `/router` is a plain command (the older `/agent-router:route` still works). The skill `agent-router:route` is not user-invocable: Claude loads it through the Skill tool.
- `main_loop: "model"` passes a model alias (`sonnet`) to the request; whether every provider accepts the alias there has not been verified.
- Calls with `isolation` (worktree or remote) are never touched.
- Escalation reads the end of a report for failure words; a report that fails without saying so is taken as a success. Its memory is per session, so a retry in a new session starts from the normal choice.

## Bench

`bench/` holds a frozen, blind-labelled benchmark (112 spawns, 15 retry chains) and `bench/run.mjs`, which runs the router's pure policy over it offline and writes `bench/results/<label>.json`. Scoring, the cost model and the dev/holdout split are described in [bench/README.md](bench/README.md).

```sh
node bench/run.mjs --label mine
```

### Results

Under-routing (below the task's minimum safe tier) is the key metric; dev / holdout are the two halves of the task set.

| Stage | Under-routed | Over-routed | Correct | Abstain | Est. cost vs all-opus | Chains |
|---|---|---|---|---|---|---|
| 0.1 baseline | 15 (7 / 8) | 10 (7 / 3) | 77.7% (74.5 / 80.7) | 0 | 79.1% | 20 / 38 |
| 1: savings, abstain, typed text | 5 (0 / 5) | 2 (0 / 2) | 92.9% (98.2 / 87.7) | 6 (5 of 6 ambiguous) | 69.9% | 20 / 38 |
| 2: error types, ESCALATE, user retry | 5 (0 / 5) | 2 (0 / 2) | 92.9% (98.2 / 87.7) | 6 (5 of 6 ambiguous) | 69.9% | 38 / 38 |
| 3: rules, presets, calibrate — default (balanced) | 5 (0 / 5) | 2 (0 / 2) | 92.9% (98.2 / 87.7) | 6 (5 of 6 ambiguous) | 69.9% | 38 / 38 |
| 3 — preset thrifty | 36 (17 / 19) | 1 (0 / 1) | 66.1% (67.3 / 64.9) | 6 | 50.4% | 25 / 38 |
| 3 — preset strict | 5 (0 / 5) | 11 (4 / 7) | 84.8% (90.9 / 78.9) | 6 | 73.9% | 38 / 38 |

Dev is the half the rules were tuned on; holdout was never looked at while tuning. The gap (0 vs 5 under-routed) is the honest measure of how far the keyword rules generalise.

## Development

```sh
claude plugin validate --strict .
claude plugin test .
claude -p /router --plugin-dir .     # first load lays the engine's types into .claude-plugin/types/
npx -y -p typescript@5 tsc -p .
```

Licensed under the Apache License 2.0. See `LICENSE` and `NOTICE`.

---

# agent-router по-русски

Плагин для Claude Code: каждому запуску субагента он подбирает модель и уровень рассуждения под задачу. Поиск по файлам больше не идёт на Opus, а рискованная работа — на дешёвую модель.

Работает **только с Claude Code** (CLI, вкладка Code в десктопе, расширения IDE). С другими агентами и обычными приложениями Claude не работает.

## Что нового в 0.2.0

- **Настоящая экономия.** Каждый запуск пишет свои токены и оценку стоимости, запрошенную и итоговую модель и сколько те же токены стоили бы на модели основной сессии. `/router` показывает оценку сэкономленного, долю запусков не на основной модели, долю повышений и долю «не выбираю».
- **«Не выбираю» (abstain).** Если в брифе нет признаков задачи или они спорят друг с другом, роутер оставляет агенту его собственные модель и усилие (или `default` проекта) и пишет об этом: `route: opus — авто: не выбираю (бриф слишком короткий)`. Самый дешёвый уровень он не угадывает.
- **Правила и пресеты.** Упорядоченный список `rules` в конфиге: совпадение по типу агента, регулярке, длине промпта или путям; первое совпадение решает, последнее правило — обязательное `default`. `preset` (`thrifty`, `balanced`, `strict`) двигает потолки модели и усилия вместе.
- **`scripts/calibrate.mjs`** офлайн читает журнал запусков и предлагает слова, порог `long_brief` и целевую долю сильной модели. Конфиг не меняет.
- **Повышение по типу ошибки.** Переполнение контекста или ответ `ESCALATE:` — сразу вверх; отказ не повторяется и не повышается, только показывается; таймаут — один повтор на той же ступени; проваленная проверка — вверх после двух, ошибка — после одной; сразу после повышения задача получает один повтор. Дешёвому агенту разрешено ответить `ESCALATE: <причина>`, причина уходит на следующую ступень. «Ещё раз», «всё ещё не работает» в новом запуске той же задачи — неудача прошлой попытки.
- **Считается только набранный текст.** Код в ограждениях, отступные блоки, диффы, стектрейсы, строки логов, цитаты и вывод инструментов выбрасываются до поиска слов; идентификаторы, пути и строки в кавычках — только слабый признак. Отрицания («не трогай оплату», “don't touch payments”) уровень не поднимают, а отрицаемый риск («не должны потерять данные») — поднимает. Русские слова ищутся во всех формах. Длинный подробный бриф не уходит на haiku.

## Зачем

Основные деньги в длинной сессии уходят на **повторное чтение контекста на каждом шаге**, а не на ответы. В одной измеренной сессии (около $393 по прайсу) 63% съел один агент-инженер на Opus, а два запуска дорастили контекст примерно до 900 тысяч токенов. Поэтому роутер делает две вещи:

1. берёт модель дешевле и усилие ниже, когда задача это позволяет;
2. просит Claude держать запуски короткими и передавать работу свежему агенту с письменной запиской, а не продолжать огромный.

## Что внутри

| Часть | Что делает |
|---|---|
| Скилл `agent-router:route` | Короткие правила перед каждым запуском агента: определить тип задачи, выбрать модель и усилие, написать строку route, после ~300k контекста передать работу новому агенту, после двух проваленных проверок поднять на ступень, механические правки делать одним скриптом, глубину проверки выбирать по риску. Общие для любого проекта и любой работы. |
| Хуки (страховка) | Срабатывают на каждый вызов Agent, даже если скилл не вызывали: выбирают модель, пишут `model` и `effort` в вызов, добавляют строку route, держат потолок, записывают запуск. |
| `/router` | Показывает запуски за сегодня и итог. |
| Конфиг (по желанию) | `.claude/agent-router.json` в проекте или `~/.claude/agent-router.json`. |

**Без всякой настройки** — без своих агентов, конфига и других плагинов — обычная сессия, где Claude сам решил запустить `general-purpose`, `Explore`, `Plan` или Agent без `subagent_type`, маршрутизируется по таблице ниже.

## Требования

- Claude Code **2.1.293 или новее**. Функциональные хуки — ранний доступ; API и тестовый набор проверены на 2.1.293. На 2.1.282 проверка плагина проходит и 111 из 112 тестов зелёные (тот набор не вызывает слой PreToolUse, который проверяет последний тест), так что старые сборки считайте непроверенными.
- Отдельная настройка не нужна: плагин из `--plugin-dir` или `CLAUDE_CODE_PLUGIN_DIRS` запускает свои хуки (проверено в чистом `HOME` через `claude -p`). Если организация запретила плагины или хуки политикой, ничего не загрузится.

## Установка

Проще всего: в сессии Claude Code добавь этот репозиторий как маркетплейс плагинов и поставь из него. Обновления — командой `/plugin marketplace update`.

```
/plugin marketplace add oleg-kalistratov/agent-router
/plugin install agent-router@agent-router
```

Или из клона:

```sh
git clone https://github.com/oleg-kalistratov/agent-router.git ~/agent-router
claude --plugin-dir ~/agent-router            # на одну сессию
```

или для всех сессий — путь в `CLAUDE_CODE_PLUGIN_DIRS` (абсолютный, несколько — через `:`), в профиле оболочки или в блоке `env` файла `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/you/agent-router" } }
```


## Как выбирает

1. **Не трогает** вызов с `isolation`, вызов изнутри субагента (если нет `"nested": true`) и типы из `skip`.
2. **Уважает явный route.** Строка `route: <модель> <усилие> — <зачем>` в промпте остаётся; недостающие `model` или `effort` берутся из неё, больше ничего не меняется.
3. **Иначе выбирает сам:**
   - **роль** агента: из его определения, если его можно прочитать (`.claude/agents/<имя>.md` проекта, `~/.claude/agents/<имя>.md` или `agents/<имя>.md` в папке плагина); определение без Edit/Write в `tools` — только чтение; затем по описанию (только чтение / поиск / план / ревью / пишет код); встроенные `Explore` и `claude-code-guide` — поиск, `Plan` — планирование, `general-purpose` и вызов без типа — правка кода; остальное — неизвестный тип;
   - **имя** неизвестного типа — слабая подсказка роли (`docs-writer` пишет, `code-reviewer` проверяет);
   - читается только **набранный текст**: код в ограждениях, отступные блоки, диффы, стектрейсы, логи, цитаты `>` и вывод инструментов выбрасываются; inline-код, пути, идентификаторы и строки в кавычках — слабый признак; то, что бриф исключает («не трогай X», «без правок в X», “don't touch X”), маскируется до конца фразы, а отрицаемый риск («не должны потерять данные») остаётся;
   - **слова** в этом тексте: рискованное или «глубокое» слово поднимает уровень; одно слабое попадание (идентификатор `PaymentSheetView` или слово, которое лишь называет экран или кнопку) — нет, два — да; механическое слово опускает уровень, только если стоит в описании или первой строке; русские слова в словарной форме ищутся во всех формах (`миграция` → миграцию, `потеря данных` → потерять данные, `безопасность`, но не «безопасно»);
   - бриф, который только ищет, перечисляет или считает, идёт на уровень поиска даже у `general-purpose`;
   - **не выбирает**, если судить не по чему: неизвестный тип без признаков, бриф короче четырёх слов, ссылка на прошлый контекст («как в прошлый раз»), рискованное слово только в теле против признака простой задачи («просто добавь…», «больше ничего»). Вызов остаётся на своей модели и усилии или на `default` проекта, в строке route — `авто: не выбираю (<почему>)`;
   - **длинный бриф не идёт на haiku**: если уровень попал на haiku, а набранный бриф не короче `long_brief` символов (1500), он поднимается до механики (или обычной, если и механика на haiku);
   - уровень даёт модель и усилие, не выше `max_model`;
   - `model` и `effort` пишутся в вызов, в начало промпта — `route: <модель> <усилие> — авто: <причина>`;
   - одно короткое уведомление и строка в debug-лог.
4. **Свою модель агента не меняет.** Если определение агента называет свою модель (или роутер видел, что тип запускается не на модели родителя), ставится только усилие. Агент плагина без найденного определения в первый раз запускается на своей модели; со второго раза роутер уже знает.
5. **Потолок.** Модель выше `max_model` и любой `fable` открывают родной диалог с вопросом и причиной: запустить, взять потолок или отменить. Если спросить некого (`claude -p`), вызов отклоняется с понятным сообщением.
6. **При любой ошибке** вызов остаётся как был.

### Таблица по умолчанию

| Уровень | Когда | Модель | Усилие |
|---|---|---|---|
| search (поиск) | агенты только для чтения | haiku | — |
| mechanical (механика) | переименуй, перенеси, отформатируй, опечатка, обнови версию, перезапусти… | sonnet | low |
| ordinary (обычная) | всё остальное, планы и ревью, неизвестные типы | sonnet | medium |
| risky (риск) | миграция, гонка, многопоточность, оплата, деньги, безопасность, авторизация, шифрование, прод, первопричина, утечка, движок… | opus | high |
| deep (глубокая) | архитектура, проектирование системы, большое решение, компромиссы | opus | xhigh |

Цены за миллион токенов (вход / выход): haiku $1/$5, sonnet $2/$10, opus $4/$20, fable $10/$50. Усилие: `low`, `medium`, `high`, `xhigh`, `max`; у haiku его нет.

## Конфиг

Необязателен. Проектный файл главнее пользовательского, тот — главнее настроек по умолчанию: `<проект>/.claude/agent-router.json`, затем `~/.claude/agent-router.json`. Поля — `tiers`, `types`, `keywords`, `max_model`, `skip`, `nested`, `main_loop`, `language`, `escalate`, `abstain` (не выбирать при отсутствии признаков, по умолчанию `true`), `default` (`{ model, effort? }` для таких вызовов), `long_brief` (порог длинного брифа, 1500), `preset`, `max_effort`, `rules` — описаны в английской таблице выше.

**Правила** (`rules`) — упорядоченный список: у каждого `match` (`type` — тип или маска, `regex`, `min_chars`/`max_chars`, `paths` — маски путей из брифа) и одно действие (`tier`, `model`+`effort`, `abstain: true` или `auto: true` — решать дальше обычным путём). Решает первое совпавшее; список обязан кончаться правилом `{ "default": true, … }`. Строка route называет правило: `авто: правило payments`.

**Пресеты**: `thrifty` — потолок sonnet/high (дёшево, но рискованная работа идёт на sonnet: на бенчмарке треть задач недомаршрутизирована), `balanced` — как по умолчанию, `strict` — потолок opus/max и уровни на ступень строже. Поля того же файла сильнее пресета.

**Калибровка**: `node scripts/calibrate.mjs [журнал] [--config файл] [--json]` — только предлагает (слова, порог `long_brief`, целевую долю opus, `default` при частом «не выбираю») и ничего не пишет. Слово в `keywords` совпадает целиком, `*` — любые буквы (`миграц*`). Файл с ошибкой целиком игнорируется: берутся настройки по умолчанию и показывается одно предупреждение.

```json
{ "max_model": "sonnet", "language": "ru", "keywords": { "risky": ["сверк*"] } }
```

**Основной цикл** (`main_loop`, по умолчанию `off`). API хуков умеет менять модель и усилие каждого запроса основного цикла. `"effort"` — усилие хода по словам вашего сообщения; `"model"` — ещё и **понижение** модели на этот ход, никогда не выше выбранной вами и не выше `max_model`. Выключено, потому что смена модели посреди разговора сбрасывает кеш промпта, и на длинном разговоре это может стоить дороже экономии.

## Повышение после неудачи

Хуки помнят последние 50 запусков сессии и оценивают каждый по завершении. Исход и что получит следующий запуск той же задачи:

- **переполнение контекста** (лимит контекста, слишком длинный промпт, обрезанный вывод) — сразу ступень вверх и просьба читать меньше;
- **`ESCALATE: <причина>`** в отчёте — сразу ступень вверх, причина идёт в новый промпт;
- **отказ** (отказ модели или отчёт, начинающийся с «Не могу помочь…» / “I can't help with …”) — без повтора и без повышения, только уведомление;
- **временная ошибка** (таймаут, лимит запросов, перегрузка, обрыв связи) — один повтор на той же ступени, потом вверх;
- **проваленная проверка** (`status: failed`, тесты не прошли, `testX fails`, 1 failure, всё ещё не работает…) — повтор на той же ступени, вверх после второй;
- **ошибка** (сбой, лимит ходов, ошибка API) — ступень вверх;
- **повтор от человека** («ещё раз», «опять», «всё ещё не работает», “try again”, “still failing” в новом запуске той же задачи; точная копия не считается) — прошлая попытка считается неудачной, ступень вверх.

Счётчики ведутся по ступеням и обнуляются после успеха; три неудачи любого вида на одной ступени тоже поднимают. Повтор идёт на той ступени, где упало, и несёт причину в промпте. **Пауза**: сразу после повышения ещё одна ошибка, проверка, таймаут или жалоба на новой ступени сначала повторяется там же, чтобы задачу не перебрасывали дважды подряд (ESCALATE и переполнение не ждут). Задача, прошедшая после повышения, в следующий раз остаётся на этой ступени. Лестница: haiku → sonnet medium → opus high → opus xhigh, не выше `max_model` и никогда до fable. Если провалилась верхняя разрешённая ступень — «задача снова не прошла на opus xhigh — нужен человек (<причина>)».

**Протокол ESCALATE.** Запуск ниже opus получает под строкой route вторую строку: «Если не можешь надёжно закончить, ответь одной строкой `ESCALATE: <причина>` и остановись». Отключается `"escalate": { "protocol": false }`.

`/router` показывает каждое повышение под его запуском и их число. Настройка — поле `escalate` (`enabled`, `protocol`, `after` с `error`, `check`, `transient`, `complaint`, `window_min`, `ladder`), пример в английском разделе.

## `/router`

`/router` показывает запуски за сегодня, модель, усилие, способ выбора и итог, а при известном расходе — оценку стоимости каждого запуска, оценку сэкономленного против основной модели, долю запусков не на основной модели, долю повышений и долю «не выбираю». Каждый запуск — строка JSON в `~/.claude/plugins/data/agent-router/spawns-<дата>.jsonl`, а по завершении — вторая строка `"kind": "usage"` с токенами, моделью, `cost` и `cost_main`. Стоимость — **оценка**: токены × цены прайса (чтение кеша 0,1×, запись 1,25× цены входа); цифра для основной модели считает те же токены.

## Вместе с другими плагинами

- **agent-office.** Формат `route: <модель> <усилие> — <зачем>` тот же, что разбирает мод agent-office, поэтому его карточка показывает маршрут каждого запуска, автоматические тоже (`— авто: …`).
- **Плагины, которые проверяют строку route в хуке PreToolUse.** Функциональные хуки работают раньше любых PreToolUse-хуков, поэтому такой хук уже видит вызов со строкой route, `model` и `effort`, и они согласованы. Если плагин хочет заставлять маршрутизировать вручную, добавьте его типы в `skip`.

## Ограничения

- Хуки видят только описание и файл определения агента и угадывают задачу по словам. Осознанный route по скиллу лучше.
- Агент плагина без найденного определения в первый раз идёт на своей модели.
- Списки слов короткие намеренно — дополняйте их в конфиге.
- Стоимость в журнале — оценка по токенам и прайсу; запуск, расход которого не пришёл (сбой), строки стоимости не имеет.
- «Не выбираю» оставляет агенту его модель — в сессии на opus это opus: надёжно, но не дёшево. Задайте `default`, если нужно иначе.
- `main_loop: "model"` передаёт в запрос псевдоним модели (`sonnet`); что его принимают все провайдеры, не проверено.
- Вызовы с `isolation` никогда не меняются.
- Повышение судит по словам в конце отчёта; провал, о котором отчёт молчит, считается успехом. Память — в пределах сессии.

## Бенчмарк

В `bench/` лежит замороженный бенчмарк с разметкой вслепую (112 запусков, 15 цепочек повторов) и `bench/run.mjs`: он прогоняет чистую политику роутера офлайн и пишет `bench/results/<метка>.json`. Подсчёт, модель стоимости и деление на dev/holdout описаны в [bench/README.md](bench/README.md). Главная метрика — недомаршрутизация (ниже минимально безопасного уровня задачи); таблица результатов — в английском разделе «Results».

Лицензия Apache 2.0, см. `LICENSE` и `NOTICE`.
