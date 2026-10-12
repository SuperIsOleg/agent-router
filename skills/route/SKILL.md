---
name: route
description: Use before every Agent (Task) spawn, in any project and for any kind of work — code, docs, data, research, writing, ops. Picks the subagent's model and reasoning effort for the task, writes the route line, keeps runs short with handoffs, and escalates only after failed checks.
user-invocable: false
---

# Route every spawn

Cost is driven by context re-read on every step, not by output. A cheap model on a short run beats a strong model on a long one. Route by the task, not by the agent's role.

## 1. Read the project config first

If `<project>/.claude/agent-router.json` or `~/.claude/agent-router.json` exists, read it once per session. Its `preset`, `rules`, `tiers`, `types`, `keywords`, `max_model`, `max_effort` and `skip` override the table below; the first matching rule in `rules` wins. Types listed in `skip` are not yours to route.

## 2. Classify the task (first match wins)

| Tier | The task is | Model | Effort |
|---|---|---|---|
| search | read-only lookup: find, list, map, summarise what exists | haiku | — |
| mechanical | the same edit many times, rename, move, format, typo, version bump, re-run a check after a trivial fix | sonnet | low |
| ordinary | a normal change or document with clear expectations, a review, a plan for known ground | sonnet | medium |
| risky | shared or core code, data migrations, money, security, auth, concurrency, persistence, production, a bug with an unknown cause | opus | high |
| deep | an architecture or other big decision that is expensive to undo | opus | xhigh |

`fable` (about 2.5× opus) only after the person says yes, asked with the reason. Never go above `max_model` (default `opus`).

## 3. Spawn

- Pass `model` and `effort` explicitly (no `effort` for haiku).
- Start the prompt with one line: `route: <model> <effort> — <why>`, e.g. `route: sonnet low — rename across 12 files`.
- Give a complete brief: goal, files or sources, what done looks like, the check to run. A good brief keeps the run short.

## 4. Keep runs short

- Past about 300k tokens of context, do not resume the agent: ask it for a handoff note (what is done, what is left, open questions, file paths), then spawn a fresh agent with that note as its brief.
- Batch mechanical edits into one script or one command instead of many tool calls.
- One agent per piece of work; reuse it with a message while its context is small.

## 5. Check by risk

- mechanical: the narrowest check that covers the touched files.
- ordinary: the targeted check, plus a review when the change is large or shared.
- risky / deep: every relevant check and a fresh-context review.

## 6. Escalate, do not loop

Read why the last run failed, then act on the next spawn of the same task. The rungs are haiku → sonnet medium → opus high → opus xhigh.

| The last run | Next spawn |
|---|---|
| ran out of context, or answered `ESCALATE: <reason>` | one rung up now; pass the reason, and for an overflow ask it to read less |
| refused | do not retry or escalate; tell the person |
| timed out, hit a rate limit or a dropped connection | once more on the same rung, then one up |
| failed a check (tests, build, lint) | once more on the same rung with the failing evidence; one up after the second |
| crashed or errored | one up |
| the person says «ещё раз», «всё ещё не работает», "still failing" | the last run failed: one up |

Right after an escalation, give the new rung one retry before moving again. Tell the person in one line, e.g. «Moving to opus: the tests failed twice on sonnet». Re-spawn with a handoff note and the failing evidence — the model is fixed at spawn, so never resume for this. Never escalate past `max_model`, and never to fable on your own. If the top allowed rung fails too, stop and ask the person.

When you spawn below opus, add under the route line: `If you cannot finish this reliably, reply with one line ESCALATE: <reason> and stop.`

## Safety net

The agent-router hooks route any spawn that has no route line, fill a missing effort from the route line, cap the model at `max_model`, escalate a retry of a recently failed task by the same rule as section 6, and log every spawn with its tokens and estimated cost (`/route` shows today's and the estimated saving). They read only the text you typed — pasted logs, code and diffs do not count, and “don't touch X” does not raise the tier. When your brief is too short or contradicts itself they abstain and keep the agent's default, so a vague brief is never cheap. They are a fallback: a deliberate route from this table is always better.
