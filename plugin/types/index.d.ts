export type Row = {
  id: string
  type: string
  task: string
  startedAt: number
  endedAt?: number
  status: string
  last: string
  tools: number
  est?: number
  nextCalcAt?: number
}

export type Panel = {
  rows: Record<string, Row>
  history: Record<string, number[]>
  now: number
  debug: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-panel': { panel: Panel }
  }
}
