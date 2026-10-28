# pi-pretty

[![npm version](https://img.shields.io/npm/v/@heyhuynhgiabuu/pi-pretty)](https://www.npmjs.com/package/@heyhuynhgiabuu/pi-pretty)
[![GitHub release](https://img.shields.io/github/v/release/buddingnewinsights/pi-pretty)](https://github.com/buddingnewinsights/pi-pretty/releases/latest)

A [pi](https://pi.dev) extension that upgrades built-in tool output in the terminal.

Tool **result bodies** start **collapsed** (header + line count) and retain a blank row below their output. Use Pi **Ctrl+O** (`app.tools.expand`) on a tool block to show full output; **Ctrl+Shift+O** expands all. See [Pi keybindings](https://pi.dev/docs/latest/keybindings).

It currently enhances:

- **user messages**: a `❯` prompt icon using `userMessageText`; **live input** follows the active thinking-level color for its icon
- **`read`**: syntax-highlighted text previews with line numbers, `read docs` labels for Pi documentation reads, plus inline image rendering when the terminal supports it
- **`bash`**: colored exit summary (`exit 0`/`exit 1`) with a preview body of command output
- **`find` / `grep`**: grouped/highlighted rendering of Pi's own search results
- **working indicator**: an [oh-my-pi](https://github.com/can1357/oh-my-pi)-style shimmer sweep in the input's top-border `Working…` row — flush-left, rotating phrases, per-session accent tint (see [Working indicator](#working-indicator-shimmer))
- **thinking label**: the hidden-thinking `Thinking...` label gets the same shimmer treatment (see [Thinking label](#thinking-label-shimmer))

> Companion to [@heyhuynhgiabuu/pi-diff](https://github.com/buddingnewinsights/pi-diff) for `write`/`edit` diff rendering.

## Install

```bash
pi install npm:@heyhuynhgiabuu/pi-pretty
```

Latest release: https://github.com/buddingnewinsights/pi-pretty/releases/latest

Or load locally:

```bash
pi -e ./src/index.ts
```

## Screenshots

![Bash and read rendering](media/bash-and-read.png)
*`bash` exit summary + output preview, and syntax-highlighted `read` text output.*

![Grep rendering](media/icons-and-grep.png)
*`find`/`grep` with grouped, highlighted rendering.*

![Inline image rendering](media/inline-image.png)
*`read` rendering an image inline in supported terminals.*

## Terminal support for inline images

Inline image previews are supported in **Ghostty**, **Kitty**, **iTerm2**, and **WezTerm**.  
When running in **tmux**, pi-pretty uses passthrough escape sequences.

> tmux must allow passthrough. Enable it with:
>
> ```tmux
> set -g allow-passthrough on
> ```
>
> (or run once in a session: `tmux set -g allow-passthrough on`)

## How to use it

### 1. Install and load `pi-pretty`

```bash
pi install npm:@heyhuynhgiabuu/pi-pretty
```

### 2. Use the built-in tools normally

You keep using the normal built-in tool names; pi-pretty re-registers them with its own renderers and
runs Pi's SDK implementation underneath, so search results and file contents are exactly what Pi
would have produced.

Examples:

```text
find pattern="*.ts" path="src"
grep pattern="handleRequest" glob="*.ts"
read path="src/index.ts"
```

### Notes

- `find` and `grep` execute through Pi's SDK (`fd` / ripgrep); pi-pretty only renders the rows.
- `find` results are grouped per directory and `grep` output is highlighted by file.

## Configuration

### Config file: `~/.pi/agent/pi-pretty.json`

Place a JSON file alongside Pi's `settings.json` to customize pi-pretty. Every option can also be set via environment variables, which take precedence over the config file: **`env var > pi-pretty.json > built-in default`** (the theme additionally falls back to `~/.pi/agent/settings.json`'s `theme` before the default).

```json
{
	"background": {
		"tool": "#1e1e2e",
		"error": "#2a1e1e"
	},
	"theme": "github-dark",
	"enableTools": [],
	"disableTools": ["grep"],
	"maxHlChars": 80000,
	"maxPreviewLines": 80,
	"cacheLimit": 128,
	"workingIndicator": {
		"text": ["Working…", "Thinking…"]
	}
}
```

| Key | Type | Env var override | Default |
| --- | --- | --- | --- |
| `background.tool` | hex color | — | terminal default |
| `background.error` | hex color | — | `background.tool` |
| `theme` | Shiki theme name | `PRETTY_THEME` | `github-dark` (after `pi-pretty.json` `theme`, then `~/.pi/agent/settings.json` `theme`, when valid Shiki themes) |
| `enableTools` | string array | `PRETTY_ENABLE_TOOLS` | `[]` (nothing ships disabled) |
| `disableTools` | string array | `PRETTY_DISABLE_TOOLS` | `[]` |
| `maxHlChars` | positive int | `PRETTY_MAX_HL_CHARS` | `80000` |
| `maxPreviewLines` | positive int | `PRETTY_MAX_PREVIEW_LINES` | `80` |
| `cacheLimit` | positive int | `PRETTY_CACHE_LIMIT` | `128` |
| `workingIndicator.enabled` | boolean | `PRETTY_WORKING_INDICATOR` (`on`/`off`) | `true` |
| `workingIndicator.text` | string or string[] (phrases rotated per sweep; env accepts comma-separated) | `PRETTY_WORKING_INDICATOR_TEXT` | `["Working…"]` |
| `workingIndicator.mode` | `shimmer` \| `kitt` \| `static` | `PRETTY_WORKING_INDICATOR_MODE` | `shimmer` |
| `workingIndicator.low` | theme color name or `#hex` | — | `dim` |
| `workingIndicator.mid` | theme color name or `#hex` | — | `muted` |
| `workingIndicator.high` | theme color name or `#hex` | — | `accent` |
| `workingIndicator.stops` | array of 2+ `#rrggbb` stops, or `"theme"`; each cell is interpolated through the band instead of snapping to `low`/`mid`/`high`. `"theme"` builds five steps around the active theme's `accent` at frame-build time, so `/theme` repaints the band. `low` stays the resting colour. Absent, empty, or single-stop falls back to the three tiers | — | unset (three tiers) |
| `workingIndicator.bold` | boolean | — | `true` |
| `workingIndicator.hint` | boolean | — | deprecated (ignored) |
| `workingIndicator.intervalMs` | integer ms, clamped to `>= 33`; higher renders fewer frames | `PRETTY_WORKING_INTERVAL_MS` | `33` (30 fps) |
| `thinkingIndicator.enabled` | boolean | `PRETTY_THINKING_INDICATOR` (`on`/`off`) | `true` |
| `thinkingIndicator.intervalMs` | integer ms, clamped to `>= 33`; higher renders fewer frames | `PRETTY_THINKING_INTERVAL_MS` | `33` (30 fps) |

- Config values take priority over theme-provided backgrounds (`toolBg` / `toolErrorBg`).
- All options except `background.*` are read once at startup; restart pi to apply changes to them (`background.*` applies live).
- To override the config directory, set `PRETTY_CONFIG_DIR` env var.

### Working indicator (shimmer)

While the agent streams, pi-pretty replaces pi's static `Working...` row with an
[oh-my-pi](https://github.com/can1357/oh-my-pi)-style shimmer: a bright accent band sweeps across the
text at 30 cells/second over a dim braille spinner, rendered **flush-left** in Pi's embedded
working-status row at the top border of the input. The custom row contains only the spinner and
shimmer text; it does not append Pi's interrupt hint or token-count status. On hosts that provide
Pi's embedded working-status API, pi-pretty supplies its custom frames to that row; older hosts
fall back to a zero-padding widget above the editor. Mode `kitt` swaps the sweep for a ping-ponging
scanner head with a decay trail; `static` renders a single unanimated frame. Tier colors resolve
`#rrggbb` hex first, then the active pi theme color name, then built-in fallbacks. Set
`workingIndicator.enabled: false` (or `PRETTY_WORKING_INDICATOR=off`) to restore pi's default
indicator. TUI sessions only; theme changes take effect on the next session.

`text` accepts a single phrase or an array — the sweep plays each phrase in order, one full band
sweep per phrase (e.g. `["Working…", "Thinking…", "Pondering…"]`). The env var splits on commas.

`stops` turns the same sweep into a continuous multi-stop gradient. Upstream quantises every cell
into one of three tiers, so a wide band reads as three flat blocks with visible steps at the tier
boundaries; with `stops` each neighbouring pair differs by a few RGB units instead. `low` is still
the resting colour, so the text does not glare while the band is off-screen. A configured list
and an absent/empty/single-stop list leaves the three tiers exactly as they were.

The value can also be `"theme"`, which is what the shipped config uses: five steps around the
active theme's `accent`, `mix(accent,black,.42) → mix(accent,black,.20) → accent →
mix(accent,white,.22) → mix(accent,white,.45)`, resolved at frame-build time. The band then
follows whatever `/theme` is active — on the generated `system` theme (accent `#a393d6`) that is
`#5f557c → #8276ab → #a393d6 → #b7abdf → #ccc4e8` — instead of animating the same five colours
under every theme. A theme whose accent is an indexed 256-colour entry carries no RGB channels;
the ramp then falls back to the theme's `text` token, and to the three tiers if that is indexed
too. The ASCII banner is the one surface that stays a fixed rainbow: it is a signature, not a
status, so `extensions/custom-banner.ts` keeps its own palette.

### Thinking label (shimmer)

With thinking blocks hidden (pi's `hideThinkingBlock` setting), the label shows elapsed reasoning
time (`Thinking... 12s`) under the same shimmer: italic `thinkingText` base with the accent band
sweeping through it. Both the active and completed labels have one
leading space for consistent output alignment. On the first text or tool delta it freezes as
`Thought for 12s`. Durations below one second use milliseconds (`250ms` instead of `0s`); longer
durations retain compact whole-second units (`12s`, `1m 05s`, `1h 02m 03s`).

Each row keeps its own label: pi-pretty intercepts the host's per-row label fan-out
(`AssistantMessageComponent.prototype.setHiddenThinkingLabel`), so the streaming row animates while
completed rows stay frozen at their own `Thought for 12s` instead of every row mirroring the latest
write. Durations live for the current session (they are not persisted across restarts). A message
with several thinking runs (interleaved `thinking → text → thinking`, common on Gemini) shares one
label line per run, so those runs accumulate a single per-message total — a later run resumes the
count instead of rewinding to zero. If the host class is missing or reshaped, the intercept falls
back to pi's global-label behavior — including restoring the default `Thinking...` at message end so
older rows are never mislabeled. The 30fps ticker runs only while the current message's last block
is thinking, bounding the cost of `setHiddenThinkingLabel(label)` rebuilding chat children. Inherits
`mode`, `bold`, and the palette/accent from `workingIndicator`.

### Environment variables

Optional environment variables:

- `PRETTY_THEME` (overrides `pi-pretty.json` `theme`, which overrides `~/.pi/agent/settings.json` `theme`; otherwise pi-pretty falls back to that setting before `github-dark`)
- `PRETTY_CONFIG_DIR` — directory to read `pi-pretty.json` from (default: `~/.pi/agent/`)
- `PRETTY_MAX_HL_CHARS` (default: `80000`)
- `PRETTY_MAX_PREVIEW_LINES` (default: `80`)
- `PRETTY_CACHE_LIMIT` (default: `128`)
- `PRETTY_WORKING_INDICATOR` (`on`/`off`, overrides `workingIndicator.enabled`)
- `PRETTY_WORKING_INDICATOR_MODE` (`shimmer`/`kitt`/`static`)
- `PRETTY_WORKING_INDICATOR_TEXT` (indicator label)
- `PRETTY_DISABLE_TOOLS` — comma-separated list of tool names to skip during registration (e.g. `read,grep`). Explicit disables take precedence over enabled defaults.
- `PRETTY_ENABLE_TOOLS` — comma-separated list of tools to force-enable. No renderer ships disabled, so this only matters if a default changes; use `PRETTY_DISABLE_TOOLS` to opt out.

## Development

Future pi-pretty custom-tool renderers should use `customToolTitle(name)` from `src/tools/labels.ts`; it returns `⚙ <name>`. Built-in tool replacements keep their own labels.

```bash
npm install
npm run typecheck
npm run lint
npm test
```

## License

MIT — [huynhgiabuu](https://github.com/buddingnewinsights)
