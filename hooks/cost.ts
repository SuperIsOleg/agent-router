import type { Model } from './config'

export type Tokens = { input: number; output: number; cache_read: number; cache_write: number }

export const PRICES: Record<Model, { input: number; output: number }> = {
  haiku: { input: 1, output: 5 },
  sonnet: { input: 2, output: 10 },
  opus: { input: 4, output: 20 },
  fable: { input: 10, output: 50 },
}

const CACHE_READ = 0.1
const CACHE_WRITE = 1.25

export function costOf(model: Model, t: Tokens): number {
  const p = PRICES[model]
  return (t.input * p.input + t.cache_write * p.input * CACHE_WRITE + t.cache_read * p.input * CACHE_READ + t.output * p.output) / 1e6
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export function tokensOf(usage: unknown): Tokens | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const u = usage as Record<string, unknown>
  const t = {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cache_read: count(u.cache_read_input_tokens),
    cache_write: count(u.cache_creation_input_tokens),
  }
  return t.input + t.output + t.cache_read + t.cache_write > 0 ? t : undefined
}

export function addTokens(a: Tokens | undefined, b: Tokens): Tokens {
  if (a === undefined) return b
  return { input: a.input + b.input, output: a.output + b.output, cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write }
}

export function money(usd: number): string {
  if (usd >= 100) return `$${usd.toFixed(0)}`
  if (usd >= 1) return `$${usd.toFixed(2)}`
  return `$${usd.toFixed(3)}`
}
