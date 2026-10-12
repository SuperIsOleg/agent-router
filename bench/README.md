# agent-router bench

An offline benchmark for the router's pure policy. It runs every frozen task and retry chain through the same functions the hooks use, with no network and no Claude, and writes `results/<label>.json`.

```sh
node bench/run.mjs --label baseline          # prints a summary and the failures on the dev half
node bench/run.mjs --label s3-thrifty --preset thrifty
node bench/run.mjs --label mine --config path/to/agent-router.json --show none
```

Node 23.6 or newer (it imports the TypeScript hooks directly).

## Frozen inputs

- `tasks.json` — 112 blind-labelled spawns: `expected_tier`, `acceptable_tiers`, `min_safe_tier`, `ambiguous`, tags (traps are `trap:*`).
- `chains.json` — 15 retry chains with an outcome per step and a free-text `expected` per step.

They were labelled by someone who never saw the router code. They are read-only: `run.mjs` checks them against `FROZEN.sha256` before every run and refuses to run if they changed. Labels we disagree with are listed in the release notes, never edited.

One exception to "read-only": on 2026-10-12 a product name inside three sample logs and one deeplink of `tasks.json` was swapped for neutral names (`App`, `com.example`, `myapp://`), and `FROZEN.sha256` was updated. No label or prompt wording changed, and every metric of the bench stayed identical (checked before and after).

## Tiers

The router's choice is turned into the tiers it satisfies:

| Tier | Satisfied by |
|---|---|
| mechanical | haiku, or sonnet with low or medium effort |
| ordinary | sonnet medium (or high), or opus low/medium (the spec names opus medium for code-writing agents; it is counted the same for every type) |
| risky | opus high |
| deep | opus xhigh or max, fable |

So `sonnet medium` satisfies both mechanical and ordinary. A missing effort counts as `high`, the Claude Code default.

**Abstain** (the router keeps the agent's own model and effort) is its own outcome: right on `ambiguous: true` tasks; on the others it is neither under- nor over-routing and is reported separately. A route to the project `default` is not an abstain; it is scored by its tier.

## Metrics (per run, for all tasks, the dev half and the holdout half)

- **under-routing** — the highest tier satisfied is below `min_safe_tier`. The key metric.
- **exact** — `expected_tier` is satisfied.
- **within** — one of `acceptable_tiers` is satisfied.
- **correct** — within, or an abstain on an ambiguous task.
- **over-routing** — the lowest tier satisfied is above every acceptable tier.
- **abstain rate** — overall and on the ambiguous tasks.
- **estimated cost against all-opus** — see below.
- **traps** — correct / total per `trap:*` tag.
- **chains** — decision points judged right, see below.

## Cost model (an estimate, not a measurement)

- prompt tokens = max(50, prompt characters / 4);
- input tokens = prompt tokens × 40 (a subagent re-reads its context on every step), output tokens = prompt tokens × 4 × an effort factor (low 0.6, medium 1, high 1.4, xhigh 1.8, max 2.2; haiku 1);
- prices per million tokens, input / output: haiku 1/5, sonnet 2/10, opus 4/20, fable 10/50;
- the all-opus line is every task on opus high; an abstain is costed on the session model, opus high.

Only the ratio is meaningful.

## Assumptions

- The session runs on opus with the default effort (high).
- Built-in types (`general-purpose`, `Explore`, `Plan`, `claude-code-guide`, `statusline-setup`) and an empty `subagent_type` inherit the session model. Every other type has no readable definition offline, so the router leaves its model to the agent (counted as the session model) and only sets the effort.

## Dev and holdout

Tasks are split by `sha256(id)`: the first 32 bits even → dev (55 tasks), odd → holdout (57). Rules are tuned only by looking at dev failures; the summary prints failures for dev only (`--show all` prints both). Both halves are reported for every stage.

## Chains

Each chain is replayed spawn by spawn, five minutes apart, with the router's memory carried over. Outcomes reach the router the way they would in a session: `error`, `timeout` and `context_overflow` as an Agent tool error with the text; `ok`, `failed_check`, `refusal` and `escalate_signal` as a finished report with the text. A model named in a step's outcome in parentheses, like `(opus xhigh)`, is taken as the model that step was spawned on.

Each line of `expected` becomes a decision point, written out in `CHAIN_POINTS` in `run.mjs` next to the label it reads:

- "After step k …" is judged on the next spawn of the same task — step k+1 when it has the same type and description and no "Step k+1" line of its own — or else on a repeat of step k;
- "Step k is …" is judged on spawn k.

The router's action at a point is read from what it did, the same way for every version:

| Action | When |
|---|---|
| needs-person | it showed the "needs a person" notice |
| stop | it showed the refusal notice and did not retry or escalate |
| escalate | the spawn runs on a higher rung than the previous attempt of the same task |
| retry-same | the previous attempt failed and the spawn runs on the same rung |
| no-change | anything else that is not lower than the previous rung (a new task, or a repeat after success) |
| dropped | a lower rung than the previous attempt (always wrong) |

Points that say "pass the agent's reason" also require the ESCALATE reason in the next prompt.

One point reads "stay at or go up one more rung" (ch-07, step 3); it is encoded as `escalate | same-rung` (same rung as the previous attempt, whatever its outcome). The first harness encoded it as `escalate | retry-same`, which cannot match after an `ok` step; it was corrected before stage 2 was scored, and the baseline and stage 1 were re-scored with the corrected harness (both moved from 19 to 20 of 38).

## Presets and the replay log

`--preset thrifty|balanced|strict` scores the same tasks under a preset. `--log out.jsonl` also writes a spawn log in the plugin's own format (spawn, usage and outcome lines): every task once with its route, and an under-routed task as a failed check followed by an escalated retry on opus high that passes; every chain step with its route and outcome. `node scripts/calibrate.mjs out.jsonl` reads it; `results/calibrate-*.txt` hold its output for the default and the thrifty replays.

## Results

`results/<label>.json` holds the summary for all / dev / holdout, the trap table, every task row (route, tier, flags, estimated cost) and every chain point.
