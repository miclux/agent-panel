# agent-panel

A Claude Code hooks-module plugin that shows a live panel of all running agents:
task, agent type, model, effort, runtime, a re-estimated remaining time with a progress bar,
the last tool call and a small animated robot. (UI texts are German.)

## Features

- Opens automatically at session start and whenever agents go from 0 to at least 1 running.
- Remaining time is estimated per agent type from the last 10 finished runs (default 90 s) and
  re-estimated at random 8-20 s intervals while the agent runs.
- Model and effort come from the agent's real `turn.step` requests.
- Command `/agentpanel` opens the panel manually (`/agents` is a built-in command and is refused).
- Fixed-width mascot column so the text never shifts when the robot blinks.

## Requirements

A Claude Code build with hooks modules (`hooks/hooks.json` with `modules`, `on('turn.step', ...)`).
Claude Code generates `.claude-plugin/types/` itself; it is not part of the repo.

## Install

**Terminal, one-off**

```bash
claude --plugin-dir /path/to/agent-panel/plugin
```

**Terminal, permanent** - set the user environment variable `CLAUDE_CODE_PLUGIN_DIRS`
to `/path/to/agent-panel/plugin` (Windows: `[Environment]::SetEnvironmentVariable('CLAUDE_CODE_PLUGIN_DIRS', '<path>\plugin', 'User')`) and restart Claude Code.

**Marketplace** (from this repo)

```text
/plugin marketplace add /path/to/agent-panel      (or the git URL)
/plugin install agent-panel@agent-panel-marketplace
```

**Claude Desktop app** - plugin dirs are not honoured there. Copy `plugin/` to
`~/.claude/dev-mods/<session-id>/agent-panel/` (session id = existing folder name under `dev-mods`)
and confirm "Enable hot reloading for this session". Per session.

## Layout

```text
.claude-plugin/marketplace.json   marketplace entry (source ./plugin)
plugin/.claude-plugin/plugin.json plugin manifest
plugin/hooks/hooks.json           { "modules": ["./register.tsx"] }
plugin/hooks/register.tsx         all logic (hooks, state, rendering)
plugin/types/index.d.ts           Row / Panel types
```
