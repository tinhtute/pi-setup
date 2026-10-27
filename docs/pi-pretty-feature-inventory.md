# pi-pretty — feature inventory for trimming

Working note, not a spec. Purpose: decide what to delete from the vendored
`extensions/pi-pretty` so the TUI stays maintainable, without losing anything the
owner actually uses.

Snapshot: `pi-pretty-vendored 0.8.0`, branch base `main@4af1300`.

## How the numbers were produced

Every LOC figure is `wc -l` of the files listed for that row (generated files in
`dist/` and `node_modules/` excluded). Test coverage is the vitest file that
exercises the row.

```bash
cd extensions/pi-pretty && find src -name '*.ts' | xargs wc -l | sort -n
ls test                     # 26 files, 384 tests
npx vitest list | wc -l
```

Totals: **6 593 LOC** of `src/`, **26 test files**, **384 passing tests**.

It is a vendored fork (`package.json` → `"name": "pi-pretty-vendored"`), installed
by `setup/install.sh` (step 4b) and loaded through `config/settings.json`
(`"extensions/pi-pretty"`). There is no upstream to stay compatible with, so
deleting features here costs nothing but the maintenance win.

## A. Tool output rendering — 1 939 LOC, 11 test files

The reason the extension exists. Everything here is on by default except `ls`.

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| A1 | `read`: Shiki syntax highlighting, line numbers, `read docs` labels for Pi documentation, inline images (kitty `ESC _G` / iTerm2 `ESC ]1337;File=`) | `tools/read.ts`, `render.ts`, `tui-text.ts`, `tools/labels.ts`, `helpers.ts` | 998 | `read-skill-rendering`, `image-rendering`, `tool-result-integrity`, `tool-title-spacing`, `tool-labels`, `tool-execution-image-ownership` |
| A2 | `bash`: coloured exit summary (`exit 0`/`exit 1`) + preview body of the output | `tools/bash.ts` | 225 | `bash-rendering` |
| A3 | `ls`: Nerd Font file-type icons, tree-oriented listing — **disabled by default** (`DEFAULT_DISABLED_TOOLS`) | `tools/ls.ts` (+ shared `config/icons.ts`) | 130 | `ls-tree-icons` |
| A4 | `find` / `grep`: replace the built-ins with FFF-backed search, frecency-ranked, grouped + highlighted rendering, glob normalisation | `tools/find.ts`, `tools/grep.ts`, `find-glob.ts` | 439 | `find-glob`, `fff-integration` |
| A5 | Tool metrics: elapsed time + output size recorded in `result.details` and shown in headers | `tools/metrics.ts` | 60 | `output-pad-metrics` |
| A6 | Block backgrounds: `background.tool`, `background.error` | `config/ansi.ts`, `config/config-file.ts` | in E1 | `theme-resolution` |

## B. Conversation chrome and editor — 1 183 LOC, 5 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| B1 | `❯` prompt icon on user messages, injected through `registerMarkdownTransformer` | `index.ts:96-100` | in E3 | `user-message-rendering` |
| B2 | User rail: one tinted cell instead of a full-width background, so acrylic/translucent terminals keep their blur | `user-rail.ts` | 80 | `user-rail` |
| B3 | Prompt editor: boxed prompt with `❯`, live input coloured by the active thinking level | `prompt-editor.ts` | 117 | `prompt-editor` |
| B4 | Per-session accent: session name hashed (djb2) to a hue on an OKLCH arc, stable per session, dimmed variant for the spinner | `session-color.ts` | 172 | `session-color` |
| B5 | `toolStyle: "claudecode"`: collapsed call rows with connector rows, consecutive tool calls folded into one group row — **opt-in, off by default** | `claude-style.ts` | 814 | `claude-style` |

## C. Animated indicators — 1 447 LOC, 5 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| C1 | Working indicator: `shimmer` / `kitt` / `static` modes, rotating phrases, `stops` (hex array or `"theme"`), `low`/`mid`/`high` tokens, `bold`, `hint`, `sessionAccent`, `intervalMs` | `indicator/{frames,gradient,stops,theme-stops,palette,settings,install}.ts` | 1 447 (shared with C2/C3) | `working-indicator`, `gradient-stops`, `gradient-labels`, `theme-stops`, `theme-resolution` |
| C2 | Thinking label: animated hidden-thinking `Thinking…` row, per-row labels, accumulated per-row duration | `indicator/thinking-label.ts`, `thinking-settings.ts` | in C1 | `thinking-lifecycle` |
| C3 | Host `Loader` labels (`Compacting…`, `Retrying…`, bash `Running…`, dialogs) shimmered with the same frame builder | `indicator/gradient.ts` | in C1 | `gradient-labels` |

Note: `stops: "theme"` resolves a five-step ramp around `theme.colors.accent`
(`theme-stops.ts`, `RAMP_STEPS = [-0.42, -0.2, 0, 0.22, 0.45]`). The banner
(`extensions/custom-banner.ts`) is a separate extension and keeps its fixed
rainbow.

## D. FFF plumbing — 484 LOC, 2 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| D1 | FFF service init, shared instance, `--pretty-fff-home-scan` / `--pretty-fff-root-scan` flags, `PRETTY_FFF_*` env | `fff.ts`, `fff-helpers.ts` | 393 | `fff-integration` |
| D2 | `@mention` autocomplete ranked by frecency | `autocomplete.ts` | 91 | — |
| D3 | `/fff` commands (`status`, rescan) | `lifecycle/fff-commands.ts` | 71 (inside E3) | `fff-integration` |

## E. Config, lifecycle, wiring — 1 540 LOC, 3 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| E1 | `~/.pi/agent/pi-pretty.json`: merge + normalise, `theme`, `icons`, `toolStyle`, `enableTools` / `disableTools`, `maxHlChars` 80 000, `maxPreviewLines` 80, `cacheLimit` 128 | `config/*` | 527 | `config-merge`, `theme-resolution` |
| E2 | Env vars: `PRETTY_DISABLE_TOOLS`, `PRETTY_ENABLE_TOOLS`, `PRETTY_FFF_*` | `config/config-file.ts:188-219` | in E1 | `extension-entrypoint` |
| E3 | Lifecycle wiring: `session_start` → `session_shutdown`, `message_update` / `message_end`, `agent_start` / `agent_end`, tool registration, thinking timer | `lifecycle/session.ts`, `lifecycle/tools.ts`, `lifecycle/fff-commands.ts` | 543 | `thinking-lifecycle`, `extension-entrypoint` |
| E4 | Terminal width clamp at 210 columns | `config/terminal.ts:5` | in E1 | — |
| E5 | Entry point, shared types, FFF footers (`NOTICE_PARTIAL_FILE_INDEX`), indicator barrel | `index.ts`, `types.ts`, `notices.ts`, `working-indicator.ts` | 470 | `extension-entrypoint` |

## Trim candidates, ordered by LOC / separability

| Priority | Slice | LOC removable | Tests removable | What is lost |
|---|---|---|---|---|
| 1 | B5 `claude-style.ts` (off by default) | 814 | `claude-style` | nothing in the current config; the opt-in style is gone |
| 2 | C1 `kitt` + `static` modes, keep `shimmer` | ~100–150 (estimate, inside `indicator/frames.ts` + `settings.ts`) | a few cases | two alternative animations |
| 3 | B4 `session-color.ts` | 172 | `session-color` | per-session tint (`sessionAccent`, thinking-level input colour) |
| 4 | A3 `tools/ls.ts` (already off by default) | 130 | `ls-tree-icons` | the `ls` override; `config/icons.ts` stays, it is shared |
| 5 | D2 `autocomplete.ts` | 91 | — | frecency-ranked `@mention`, falls back to Pi's built-in provider |
| 6 | D1 home/root scan flags | ~30 (estimate, `config/config-file.ts`) | — | indexing `/` and `$HOME` by flag |
| 7 | B2 `user-rail.ts` | 80 | `user-rail` | the one-cell rail; user messages go back to the host's rendering |
| 8 | B3 `prompt-editor.ts` | 117 | `prompt-editor` | the boxed prompt around live input |

Slices 1–6 remove roughly **1 350 LOC and 3 test files** without touching a
feature that is enabled today. Adding 7–8 brings it to about 1 550 LOC, at the
cost of two visible changes.

## What would change this answer

- `toolStyle: "claudecode"` gets adopted → slice 1 is a feature, not dead weight, despite being the biggest file.
- `ls` gets enabled (it is one config key away) → slice 4 is a feature.
- A future Pi version ships its own shimmer / `Loader` styling → C3 becomes duplicate work and should be re-evaluated before C1.

## Continuing on another machine

```bash
git switch docs/pi-pretty-feature-inventory
cd extensions/pi-pretty && npx tsc --noEmit && npx vitest run   # 384 tests
cd ../.. && TMPDIR=$HOME/.cache/tmp node tests/run-all.mjs       # 11 repo suites
```

Deleting any slice means: remove the module, drop its config keys from
`pi-pretty.example.json` and `config/pi-pretty.json`, delete its tests, update
`extensions/pi-pretty/README.md` and the root `README.md`, then
`rsync -a extensions/pi-pretty/ ~/.pi/agent/extensions/pi-pretty/` and `/reload`
in Pi to see the result live.
