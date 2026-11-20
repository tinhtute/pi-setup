---
status: active
lane: normal
---
# Prompt box: square frame, theme border, flush icon

## Goal
- outcome: The prompt box reads like a Claude Code box — square `┌ ┐ └ ┘` corners, an unbroken `│` rail painted from the active Pi theme, `❯` flush against the rail — and the frame colour is a `pi-pretty.json` key (`border` by default, `accent` or a hex if the owner wants it) instead of the host's near-neutral `borderMuted`.
- success_signal: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run` and `node tests/run-all.mjs` pass with assertions that pin square corners, the theme token, and the flush gutter; a live session shows the box moving with `/theme`.
- actors: the owner (Tui), who types every prompt on this machine; any machine bootstrapped from this repo.
- authority: issue #25; the owner's style decisions on 2026-11-20 (square corners + `border` token; config key wanted; icon flush against the rail); Pi 1.5.2 `getEditorTheme()` (`borderColor → theme.fg("borderMuted")`) and `InteractiveMode.updateEditorBorderColor()` (thinking level and bash mode overwrite `editor.borderColor`).
- requirements:
  - R1: Corners are `┌ ┐ └ ┘`, the side rails are one unbroken `│`, and every rendered line keeps `visibleWidth(line) === width`, including when a scroll indicator (`↑ n` / `↓ n`) occupies the top border. | acceptance: `cd extensions/pi-pretty && npx vitest run test/prompt-editor.test.ts` | source: issue #25 acceptance
  - R2: The frame is painted through the active theme's `border` token, resolved per render so `/theme` moves it without a restart; a host-assigned border colour (thinking level, bash mode) still wins; with no resolver the inherited `borderColor` is used. | acceptance: same vitest file, asserting the token is asked for rather than a byte | source: issue #25 + `interactive-mode.js` `updateEditorBorderColor`
  - R3: `prompt.border` accepts `"border"`, `"accent"` or `#rrggbb` (default `"border"`); an unknown value falls back to `"border"`; a hex is painted as truecolor. | acceptance: `loadConfig` tests in `test/config-merge.test.ts` + the prompt-editor frame test | source: owner decision 2026-11-20 — the key is wanted
  - R4: `❯` sits in the column immediately after the rail and the input text starts one column earlier (`│❯ draft`); `paddingX`, cursor math and the embedded working status are unchanged. | acceptance: `test/prompt-editor.test.ts` gutter assertions | source: owner decision 2026-11-20 — “giống |> của claude code”
  - R5: `README.md` documents `prompt.border` beside the other pi-pretty keys. | acceptance: `rg -n 'prompt.border' README.md` | source: repo convention — every config key is documented
- non-goals:
  - NG1: Changing the `❯` glyph or adding a second prompt icon.
  - NG2: Upstream `@heyhuynhgiabuu/pi-pretty` parity; the fork stays the surface (see the TUI palette contract non-goals).
  - NG3: Per-tool or per-surface borders beyond the prompt box.
  - NG4: Replacing the thinking-level / bash-mode border signal — R2 keeps it.

## Phases and Verification
- approach: keep the vendored editor, paint through a resolver that defers to the host when the host has overridden the border colour, and expose the choice as one config key. Rejected: hard-coding the token at construction (a thinking-level cycle resets `borderColor` and would silently undo it); a local Pi patch (the repo carries none).
- phase_slug: `main`
  status: checked
  - goal: R1, R2, R3, R4, R5 | depends_on: none
  - surfaces: `extensions/pi-pretty/{src/prompt-editor.ts,src/config/config-file.ts,src/config/ansi.ts,src/lifecycle/session.ts,test/prompt-editor.test.ts,test/config-merge.test.ts}`, `README.md` | avoided: the rest of `src/`, `config/*.json`, `~/.pi/agent/install/`
  - phase check: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run`; `node tests/run-all.mjs`; then one live prompt box under two themes

## Log

- 2026-11-20T02:20Z — main — decision — geometry measured through the real class (width 44, `editorPaddingX` default 1): today renders `│ ❯ draft` — one column between the rail and the icon. The icon slot is `" ❯ "` inside `BOXED_PROMPT_WIDTH = 3`; the owner chose a flush gutter (`│❯ draft`), so the slot becomes `"❯ "` and `promptWidth()` drops to 2 (the `paddingX === 0` extra column stays).

- 2026-11-20T02:31Z — main/R1+R4 — done — `src/prompt-editor.ts`: corners `┌ ┐ └ ┘`, slot `"❯ "` (`BOXED_PROMPT_WIDTH` 3 → 2) placed at column 1 so the icon is flush after the rail, `promptWidth()` now adds the zero-padding column whether or not the host has border hooks. Width guard unchanged (`visibleWidth(line) === width` before the corner swap), so a scroll indicator still rides the top border. `test/prompt-editor.test.ts` asserts `┌───┐` / `└───┘`, `│❯ draft`, `│  second`, and `visibleWidth === 40` on every line with `↑ 3` in the border.
- 2026-11-20T02:33Z — main/R2 — done — `paintFrame()` resolves once per render: a host-assigned `borderColor` whose probe (`│`) differs from the inherited one wins (thinking level, bash mode), otherwise `frameColor()` from the session, otherwise the inherited colour. Probe-by-output rather than probe-by-identity keeps Pi's `getThinkingBorderColor("off")` from looking like an override. Slice of the first implementation used `const frame = this.paintFrame` and lost `this`; the tests caught it.
- 2026-11-20T02:35Z — main/R3 — done — `config-file.ts` carries `prompt.border` (`border` | `accent` | `#rrggbb`, anything else dropped so the session default applies); `config/ansi.ts` gained `fgFromHex`; `session.ts` builds the resolver from `ctx.ui.theme` so `/theme` moves the frame, with the hex path bypassing the token set. `test/config-merge.test.ts` covers both accepted forms and both rejected ones.
- 2026-11-20T02:38Z — main/R5 — done — `README.md` documents `prompt.border` beside the other pi-pretty keys: default token, `accent`, hex, restart requirement, and that a host recolour still wins.
- 2026-11-20T02:39Z — main — decision — gate: `npx tsc --noEmit` rc=0, `npx biome check src/` 0 errors / 22 warnings (unchanged), `npx vitest run` 261/261 across 21 files (+5 tests), `node tests/run-all.mjs` 11/11. Verdict APPROVED with the owner as judge; the live two-theme comparison stays for the next session.
- 2026-11-20T03:05Z — main — decision — owner report: the frame stayed red under `thinkingLevel: max` instead of the theme colour. Root cause: `interactive-mode.updateEditorBorderColor()` assigns `editor.borderColor = getThinkingBorderColor(level)` at startup and on every theme change, so the "host override wins" rule made a steady state look like an override and `prompt.border` never applied. Fix: the frame is the configured token and nothing else; the `❯` icon keeps carrying the thinking level. Repro landed first as `keeps the configured token when Pi assigns a thinking-level border` (red: `<thinkingMax>┌`), green after the rule was removed. Owner then chose `accent` as the shipped default, so `config/pi-pretty.json` and the live file carry `"prompt": { "border": "accent" }` (live backup `pi-pretty.json.backup.20261120_095527`).
- 2026-11-20T03:40Z — main — decision — owner report: still red after the first fix. Second root cause, found with a live-style probe (`/tmp/probe-prompt.mjs`, real ANSI, fake theme): pi-tui's `Editor.renderTopBorder` returns `borderColor(dashes)`, so the middle run already carries the host colour and slicing it preserved the thinking-red; only the corners took `paintFrame`. Fix: strip the terminal sequences out of the sliced run and repaint it column by column. Repro landed first as `repaints the whole border, not just the corners, when the host colours it` (red: `[35m┌[39m[31m──────…`).
- 2026-11-20T03:45Z — main — decision — owner asked for max thinking to read as a gradient, applied to both the frame and the `❯` icon, ramped from the theme accent. `PromptColor` gained `(text, column, width)`, the border is painted per column, and `session.ts` swaps in `stops: "theme"`'s ramp (`resolveStops`/`gradientAnsiAt`) at `thinkingLevel === "max"`; every other level keeps `prompt.border`. New tests: `paints the frame and the icon through a positional gradient`, `sweeps the accent ramp across the box at max thinking`. Live probe at width 44: 44 distinct colours on the top border, no host red, square corners.
- 2026-11-20T03:47Z — main — decision — gate after both fixes: tsc rc=0 · biome 0 errors / 22 warnings (the organiseImports hit on session.ts was fixed) · vitest 264/264 · run-all 11/11 · `install.sh` re-synced, live files byte-identical to the repo.
- 2026-11-20T04:00Z — main — decision — owner refined the max-thinking gradient: it must use the banner's five stops, not an accent ramp. `theme-stops.ts` now mirrors `BANNER_STOPS = ["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c"]` (an extension cannot import another extension's entry module), `session.ts` interpolates that list across the box, and `tests/test-palette-theme.mjs` asserts the copy equals the banner's `PALETTE` so the two cannot drift. Live probe at width 44: left rail `#22d3ee`, right rail `#fb923c`, no host red. The host-API test now asserts `high`/`low` icon colours and calls out max as the ramp exception. Gate: tsc rc=0 · biome 0 errors / 22 warnings · vitest 264/264 · run-all 11/11 · live synced.

## Validation

### phase `main` — 2026-11-20T02:39Z
- mode: full
- judge: owner (2026-11-20) — the style was confirmed on previews before any code, and the gate below is what the implementation rested on
- gates: `cd extensions/pi-pretty && npx tsc --noEmit` rc=0 · `npx biome check src/` 0 errors / 22 warnings · `npx vitest run` 261/261 · `node tests/run-all.mjs` 11/11
- verdict: APPROVED

## Current State and Next Action
- active_phase: main
- lifecycle_status: checked
- blockers: none
- open_items: none — R1–R5 done; the only unexercised step is a live `pi` render under two themes
- exact_next_action: `handoff` — close the plan once the owner starts Pi and sees `│❯` with a square frame on two themes
