# agent-panel - implementation log

Requirements: a panel listing all running Claude Code agents (task, runtime, ETA, model, effort,
last tool), deliverable to other environments as a plugin.

## Architecture
- `plugin/hooks/register.tsx` registers hooks on `session.start`, `command.run` (`agentpanel`),
  `tool.call`, `turn.step` and `ui.render` (component `Pane`, id `agent-panel`).
- State: one `atom` `{rows, history, now, debug}`; a 1 s timer (`$.clock.every`) runs `tick`, which
  diffs `$.agent.list()` against the rows, finishes vanished/ended agents and stores their duration
  in `history[type]` (last 10).
- `runInfo` (module-level map agentId -> model/effort) is filled by the `turn.step` hook.

## Behaviours and parameters
- Auto-open: `$.ui.open` at session start and when running agents go 0 -> >0 (`hadRunning`).
- ETA: `typical()` = mean of history, default `DEFAULT_MS` 90 s; per row `est`/`nextCalcAt`
  recomputed every 8-20 s (random): if elapsed > 0.8 x base then `max(base, elapsed x 1.25)`.
- Finished rows stay `KEEP_DONE_MS` 120 s. Mascot column is 9 chars wide, `flexShrink 0`, lines padded.

## Stumbling blocks
- `/agents` is a built-in command: `$.command.register` throws and skipped the whole `session.start`
  hook -> command renamed to `/agentpanel`, registration wrapped in `.catch`.
- `turn.step` is a streaming event: the hook must be `async function*` with `return yield* next(e)`;
  an `async` function makes the whole module fail to load (panel never opens). Check with
  `claude -p x --debug-file f` and grep `agent-panel` in the file.
- Desktop app ignores `CLAUDE_CODE_PLUGIN_DIRS`; use `dev-mods/<session-id>` hot reload.

## Known limits
- ETA is time-based only (no total tool count known). `$.ui.open` behaviour on an already open pane
  and the model/effort display were verified only by load check, not visually.
