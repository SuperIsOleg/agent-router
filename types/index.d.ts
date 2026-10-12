export type MainTurn = {
  tier: 'search' | 'mechanical' | 'ordinary' | 'risky' | 'deep'
  why: string
  shown: string
}

export type SpawnMemo = {
  id: string
  agentId?: string
  type: string
  desc: string
  fp: string
  model: 'haiku' | 'sonnet' | 'opus' | 'fable'
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  outcome: 'pending' | 'ok' | 'error' | 'check' | 'transient' | 'overflow' | 'refusal' | 'signal' | 'complaint' | 'neutral'
  escalated?: boolean
  lifted?: boolean
  cause?: string
  at: number
  main?: 'haiku' | 'sonnet' | 'opus' | 'fable'
}

export type AgentTurn = {
  tokens: { input: number; output: number; cache_read: number; cache_write: number }
  model?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-router': { mainTurn: MainTurn | null; recent: SpawnMemo[]; turns: Record<string, AgentTurn> }
  }
}
