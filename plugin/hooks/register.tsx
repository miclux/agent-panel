import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Panel, Row } from '../types'

const PANE = 'agent-panel'
const DEFAULT_MS = 90_000
const KEEP_DONE_MS = 120_000

const panel = atom(
  { plugin: 'agent-panel', key: 'panel' } as const,
  { rows: {}, history: {}, now: 0, debug: '' } as Panel,
)

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const typical = (p: Panel, type: string): number => {
  const h = p.history[type]
  return h && h.length > 0 ? h.reduce((a, b) => a + b, 0) / h.length : DEFAULT_MS
}

const robot = (row: Row, now: number): string[] => {
  const done = row.endedAt !== undefined
  const failed = row.status === 'failed' || row.status === 'killed'
  const blink = Math.floor(now / 1000) % 4 === 0
  const face = failed ? '[x_x]' : done ? '[^_^]' : blink ? '[-_-]' : '[o_o]'
  const arms = done || failed ? ' /|_|\\ ' : Math.floor(now / 1000) % 2 === 0 ? ' \\|_|/ ' : ' /|_|\\ '
  return ['  _|_  ', ` ${face} `, arms, '  / \\  ']
}

async function tick($: any): Promise<void> {
  try {
    await tickInner($)
  } catch (err) {
    await update($, panel, (p: Panel): Panel => ({ ...p, debug: `Fehler: ${String(err)}` }))
  }
}

async function tickInner($: any): Promise<void> {
  const now: number = await $.clock.now()
  const list: { id: string; type: string; description: string; status: string }[] =
    await $.agent.list()
  const debug = ''

  await update($, panel, (p: Panel): Panel => {
    const rows = { ...p.rows }
    const history = { ...p.history }
    const seen = new Set<string>()

    const finish = (row: Row, status: string): Row => {
      const took = now - row.startedAt
      history[row.type] = [...(history[row.type] ?? []), took].slice(-10)
      return { ...row, endedAt: now, status, last: status === 'completed' ? 'fertig' : status }
    }

    for (const a of list) {
      seen.add(a.id)
      const old = rows[a.id]
      const running = !['completed', 'failed', 'killed', 'stopped', 'cancelled'].includes(a.status)
      if (!old) {
        if (running) {
          rows[a.id] = {
            id: a.id,
            type: a.type,
            task: a.description,
            startedAt: now,
            status: a.status,
            last: 'startet …',
            tools: 0,
          }
        }
      } else if (old.endedAt === undefined && !running) {
        rows[a.id] = finish(old, a.status)
      }
    }

    for (const row of Object.values(rows)) {
      if (!seen.has(row.id) && row.endedAt === undefined) {
        rows[row.id] = finish(row, 'completed')
      }
      const r = rows[row.id]
      if (r && r.endedAt !== undefined && now - r.endedAt > KEEP_DONE_MS) delete rows[row.id]
      // Sporadically re-estimate the total duration of running agents (random 8-20s apart).
      if (r && r.endedAt === undefined && now >= (r.nextCalcAt ?? 0)) {
        const base = typical({ rows, history, now, debug }, r.type)
        const elapsed = now - r.startedAt
        const est = elapsed > base * 0.8 ? Math.max(base, elapsed * 1.25) : base
        rows[r.id] = { ...r, est, nextCalcAt: now + 8_000 + Math.random() * 12_000 }
      }
    }

    return { rows, history, now, debug }
  })

  // Auto-open the pane when an agent becomes active (0 -> >0 running agents).
  const anyRunning = list.some(
    a => !['completed', 'failed', 'killed', 'stopped', 'cancelled'].includes(a.status),
  )
  if (anyRunning && !hadRunning) await $.ui.open({ id: PANE, title: 'Agenten' })
  hadRunning = anyRunning
}

const runInfo: Record<string, { model: string; effort?: string }> = {}
const shortModel = (m: string): string => m.replace(/^claude-/, '')
let hadRunning = false
let timerOn = false
const ensureTimer = ($: any): void => {
  if (timerOn) return
  timerOn = true
  $.clock.every(1000, () => void tick($))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // "/agents" is a built-in command in newer builds and the registration is refused (which skipped this whole hook),
    // so the panel's own command is "/agentpanel" and a refusal no longer stops the panel from opening.
    await $.command
      .register({
        name: 'agentpanel',
        description: 'Zeigt alle laufenden Agenten in einem Panel',
      })
      .catch(() => undefined)
    void $.ui.open({ id: PANE, title: 'Agenten' })
    ensureTimer($)

    return next(e)
  })

  on('command.run', { command: 'agentpanel' }, async $ => {
    ensureTimer($)
    await $.ui.open({ id: PANE, title: 'Agenten' })

    return { text: 'Agenten-Panel geöffnet.' }
  })

  on('tool.call', async ($, e, next) => {
    ensureTimer($)
    const id = (e as { agentId?: string }).agentId
    if (id) {
      const a = e as unknown as Record<string, unknown>
      const hint = String(
        a.file_path ?? a.command ?? a.pattern ?? a.description ?? a.url ?? a.query ?? '',
      )
      await update($, panel, (p: Panel): Panel => {
        const row = p.rows[id]
        if (!row || row.endedAt !== undefined) return p
        const last = clip(`${e.tool} ${hint}`.trim(), 60)

        return { ...p, rows: { ...p.rows, [id]: { ...row, last, tools: row.tools + 1 } } }
      })
    }

    return next(e)
  })

  // Remember the model and effort each subagent's requests actually run with.
  // turn.step is a streaming event: the hook is an async generator that forwards the chunks.
  on('turn.step', async function* ($, e, next) {
    const id = (e as { agentId?: string }).agentId
    if (id) runInfo[id] = { model: shortModel(e.model), effort: e.effort === undefined ? undefined : String(e.effort) }

    return yield* next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    ensureTimer($)
    const p = await read($, panel)
    const rows = Object.values(p.rows).sort((a, b) => b.startedAt - a.startedAt)
    const running = rows.filter(r => r.endedAt === undefined).length

    return (
      <Box flexDirection="column">
        <Text bold>
          {running} Agent{running === 1 ? '' : 'en'} aktiv
        </Text>
        {rows.length === 0 && <Text dimColor>Keine Agenten unterwegs.</Text>}
        {p.debug ? <Text color="red">{p.debug}</Text> : null}
        {rows.map(row => {
          const done = row.endedAt !== undefined
          const failed = row.status === 'failed' || row.status === 'killed'
          const elapsed = (row.endedAt ?? p.now) - row.startedAt
          const usual = typical(p, row.type)
          const est = row.est ?? usual
          const ratio = done ? 1 : Math.min(0.95, elapsed / est)
          const filled = Math.round(ratio * 16)
          const bar = '█'.repeat(filled) + '░'.repeat(16 - filled)
          const eta = done
            ? failed
              ? 'abgebrochen'
              : 'fertig'
            : elapsed > usual
              ? `dauert länger als üblich, noch ca. ${fmt(est - elapsed)}`
              : `noch ca. ${fmt(est - elapsed)}`
          const color = failed ? 'red' : done ? 'green' : 'cyan'

          return (
            <Box borderStyle="round" borderColor={color} paddingX={1} marginTop={1}>
              <Box flexDirection="column" width={9} minWidth={9} flexShrink={0} flexGrow={0}>
                {robot(row, p.now).map(line => (
                  <Text color={color}>{line.padEnd(9, ' ')}</Text>
                ))}
              </Box>
              <Box flexDirection="column">
                <Text bold>{clip(row.task, 50)}</Text>
                <Text dimColor>
                  {row.type} · Modell: {runInfo[row.id]?.model ?? '?'} · Aufwand:{' '}
                  {runInfo[row.id]?.effort ?? 'Standard'}
                </Text>
                <Text>
                  Läuft seit {fmt(elapsed)} · {eta}
                </Text>
                <Text color={color}>
                  {bar} {Math.round(ratio * 100)}%
                </Text>
                <Text dimColor>
                  Stand: {row.last} ({row.tools} Tool-Aufrufe)
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
