#!/usr/bin/env node
// Offline: reads agent-router's JSONL spawn logs and proposes keyword, threshold and strong-model-share changes.
// It only prints proposals; it never writes the config. Usage:
//   node scripts/calibrate.mjs [log.jsonl | log-dir ...] [--config agent-router.json] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

const HOOKS = resolve(dirname(fileURLToPath(import.meta.url)), '../hooks')
const { calibrate, report } = await import(pathToFileURL(join(HOOKS, 'calibrate.ts')).href)
const { DEFAULTS, merge, validate } = await import(pathToFileURL(join(HOOKS, 'config.ts')).href)

const args = process.argv.slice(2)
const json = args.includes('--json')
const ci = args.indexOf('--config')
const configFile = ci >= 0 ? args[ci + 1] : undefined
const inputs = args.filter((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1))
if (inputs.length === 0) inputs.push(process.env.CLAUDE_PLUGIN_DATA ?? join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'plugins/data/agent-router'))

let config = DEFAULTS
if (configFile !== undefined) {
  const checked = validate(JSON.parse(readFileSync(configFile, 'utf8')))
  if (!('layer' in checked)) {
    console.error(`calibrate: ${configFile} is invalid (${checked.error})`)
    process.exit(2)
  }
  config = merge(DEFAULTS, checked.layer)
}

const files = inputs.flatMap(p =>
  existsSync(p) && statSync(p).isDirectory()
    ? readdirSync(p).filter(f => /^spawns-.*\.jsonl$/.test(f)).sort().map(f => join(p, f))
    : [p],
)
const rows = []
for (const f of files) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      rows.push(JSON.parse(line))
    } catch {
      continue
    }
  }
}
if (rows.length === 0) {
  console.error(`calibrate: no log lines in ${files.join(', ') || inputs.join(', ')}`)
  process.exit(1)
}
const result = calibrate(rows, config)
console.log(json ? JSON.stringify(result, null, 1) : report(result))
