# pi-pretty — feature inventory for trimming

Working note, not a spec. Purpose: decide what to delete from the vendored
`extensions/pi-pretty` so the TUI stays maintainable, without losing anything the
owner actually uses.

**Status: in progress.** Round 1 shipped in #20 (slices D and B5, ~3 500 lines).
The section [Progress](#progress) records what is done and what is next; the
inventory below is the measurement the ranking rests on.

Snapshot: `main@1f9628a` (after #20). Round 1 was measured at `4af1300`.

## How the numbers were produced

Every LOC figure is `wc -l` of the files listed for that row (generated files in
`dist/` and `node_modules/` excluded). Test coverage is the vitest file that
exercises the row.

```bash
cd extensions/pi-pretty && find src -name '*.ts' | xargs wc -l | sort -n
ls test | wc -l
npx vitest list | wc -l
```

| | `4af1300` (round 1 base) | now |
|---|---|---|
| `src/` LOC | 6 593 | **4 423** |
| test files | 26 | **23** |
| passing tests | 384 | **284** |

It is a vendored fork (`package.json` → `"name": "pi-pretty-vendored"`), installed
by `setup/install.sh` (step 4b) and loaded through `config/settings.json`
(`"extensions/pi-pretty"`). There is no upstream to stay compatible with, so
deleting features here costs nothing but the maintenance win.

## A. Tool output rendering — 1 650 LOC, 10 test files

The reason the extension exists. Everything here is on by default except `ls`.

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| A1 | `read`: Shiki syntax highlighting, line numbers, `read docs` labels for Pi documentation, inline images (kitty `ESC _G` / iTerm2 `ESC ]1337;File=`) | `tools/read.ts`, `render.ts`, `tui-text.ts`, `tools/labels.ts`, `helpers.ts` | 943 | `read-skill-rendering`, `image-rendering`, `tool-result-integrity`, `tool-title-spacing`, `tool-labels`, `tool-execution-image-ownership`, `tui-text`, `tool-prompt-metadata` |
| A2 | `bash`: coloured exit summary (`exit 0`/`exit 1`) + preview body of the output | `tools/bash.ts` | 224 | `bash-rendering` |
| A3 | `ls`: Nerd Font file-type icons, tree-oriented listing — **disabled by default** (`DEFAULT_DISABLED_TOOLS`) | `tools/ls.ts` (+ shared `config/icons.ts`) | 129 | `ls-tree-icons` |
| A4 | `find` / `grep`: re-registered over Pi's SDK (`fd` / ripgrep), grouped + highlighted rendering, notices | `tools/find.ts`, `tools/grep.ts` | 294 | `find-grep-sdk` |
| A5 | Tool metrics: elapsed time + output size recorded in `result.details` and shown in headers | `tools/metrics.ts` | 60 | `output-pad-metrics` |
| A6 | Block backgrounds: `background.tool`, `background.error` | `config/ansi.ts`, `config/config-file.ts` | in E1 | `theme-resolution` |

## B. Conversation chrome and editor — 191 LOC, 2 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| B1 | `❯` prompt icon on user messages, injected through `registerMarkdownTransformer` | `index.ts` | in E5 | `user-message-rendering` |
| B2 | User rail: one tinted cell instead of a full-width background, so acrylic/translucent terminals keep their blur — **disabled by default** (no `userRail` key in the shipped config) | `user-rail.ts` | 80 | `user-rail` |
| B3 | Prompt editor: boxed prompt with `❯`, live input coloured by the active thinking level | `prompt-editor.ts` | 111 | `prompt-editor` |
| ~~B4~~ | ~~Per-session accent: session name hashed (djb2) to a hue on an OKLCH arc~~ — **removed** | — | 0 | — |
| ~~B5~~ | ~~`toolStyle: "claudecode"`~~ — **removed in #20** | — | 0 | — |

## C. Animated indicators — 1 428 LOC, 5 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| C1 | Working indicator: `shimmer` / `kitt` / `static` modes, rotating phrases, `stops` (hex array or `"theme"`), `low`/`mid`/`high` tokens, `bold`, `hint`, `intervalMs` | `indicator/{frames,gradient,stops,theme-stops,palette,settings,install}.ts` | 1 428 (shared with C2/C3) | `working-indicator`, `gradient-stops`, `gradient-labels`, `theme-stops`, `theme-resolution` |
| C2 | Thinking label: animated hidden-thinking `Thinking…` row, per-row labels, accumulated per-row duration | `indicator/thinking-label.ts`, `thinking-settings.ts` | in C1 | `thinking-lifecycle` |
| C3 | Host `Loader` labels (`Compacting…`, `Retrying…`, bash `Running…`, dialogs) shimmered with the same frame builder | `indicator/gradient.ts` | in C1 | `gradient-labels` |

Note: `stops: "theme"` resolves a five-step ramp around `theme.colors.accent`
(`theme-stops.ts`, `RAMP_STEPS = [-0.42, -0.2, 0, 0.22, 0.45]`). The banner
(`extensions/custom-banner.ts`) is a separate extension and keeps its fixed
rainbow.

## D. FFF plumbing — 0 LOC

**Removed in #20.** Was: `fff.ts`, `fff-helpers.ts`, `autocomplete.ts`
(`@mention` provider), `lifecycle/fff-commands.ts` (`/fff-health`, `/fff-rescan`),
`find-glob.ts`, `notices.ts`, plus the `@ff-labs/fff-node` dependency, the
`--pretty-fff-*` flags, the `PRETTY_FFF_*` env vars and the `fff` config block.

`find` / `grep` were not lost: they keep their renderers and now always run Pi's
SDK implementation, which is the branch they already took whenever FFF was
missing or out of scope.

## E. Config, lifecycle, wiring — 1 154 LOC, 3 test files

| # | Feature | Code | LOC | Tests |
|---|---|---|---|---|
| E1 | `~/.pi/agent/pi-pretty.json`: merge + normalise, `theme`, `icons`, `userRail`, `enableTools` / `disableTools`, `maxHlChars` 80 000, `maxPreviewLines` 80, `cacheLimit` 128 | `config/*` + the `config.ts` barrel | 490 | `config-merge`, `theme-resolution` |
| E2 | Env vars: `PRETTY_DISABLE_TOOLS`, `PRETTY_ENABLE_TOOLS` (`PRETTY_FFF_*` removed in #20) | `config/config-file.ts` | in E1 | `extension-entrypoint` |
| E3 | Lifecycle wiring: `session_start` → `session_shutdown`, `message_update` / `message_end`, `agent_start` / `agent_end`, tool registration, thinking timer | `lifecycle/session.ts`, `lifecycle/tools.ts` | 389 | `thinking-lifecycle`, `extension-entrypoint` |
| E4 | Terminal width clamp at 210 columns | `config/terminal.ts` | in E1 | — |
| E5 | Entry point, shared types, indicator barrel | `index.ts`, `types.ts`, `working-indicator.ts` | 275 | `extension-entrypoint` |

## Progress

Round 3 — **done**: A3 `tools/ls.ts` (129 LOC) and B2 `user-rail.ts` (80 LOC), plus the
orphan sweep the row-3 estimate got wrong. Deleting the `ls` renderer left
`renderTree`/`isLsNotice` and the whole of `config/icons.ts` (87 LOC) with no importer, and
`icons` / `PRETTY_ICONS` existed only to feed that table, so they went too. The `ls` cases
inside five otherwise-generic suites (output pad, duration, title spacing, prompt metadata,
header sweep) were pruned; the generic ones now ride on `read`/`find`. Result: 4 423 →
4 049 LOC of `src/` (35 → 32 files), 284 → 256 tests (23 → 21 files), biome still **0
errors** (27 warnings, down from 33 with the deleted files).

Round 2 — **done**: B4 `session-color.ts` (172 LOC, `session-color` test, the
`sessionAccent` key, the `sessionName` parameters on `installWorkingIndicator` and
`createThinkingLabelAnimator`, and the `session_info_changed` handler that existed
only to re-tint on rename). `hexToAnsiFg` moved to `indicator/palette.ts`. The two
long-standing biome `organizeImports` errors in `install.ts` and `settings.ts` went
with the touch, so `npx biome check src/` is now **0 errors** (33 warnings).


Round 1 — **done**, shipped in [#20](https://github.com/tinhtute/pi-setup/pull/20):

- [x] D `fff.ts` + `fff-helpers.ts` + `autocomplete.ts` + `fff-commands.ts` + `find-glob.ts` + `notices.ts` + `@ff-labs/fff-node`
- [x] B5 `claude-style.ts` (814) and the `toolStyle` key
- [x] `extensions/pretty-border.ts` (206 + 97 test) — it only re-boxed the prompt B5 unboxed
- [x] `config/pi-pretty.json`, `pi-pretty.example.json`, extension README, CHANGELOG, root README
- [x] regression hole: `find`/`grep` lost their only test with `fff-integration`; `test/find-grep-sdk.test.ts` (7 cases) now pins the SDK passthrough, the `findResult`/`grepResult` details shape, the empty-answer normalisation, and CRLF handling
- [x] bug the new tests caught: `normalizeSdkFindOutput` split the SDK's bracketed notice on `. `, so `[100 entries limit reached. Use limit=200 for more]` arrived as two entries and the renderer re-joined them — correct for that string only. One block is now one notice

Result: 6 593 → 4 423 LOC, 384 → 284 tests (26 → 23 files), −3 816 lines net in #20
plus 172 in round 2.

### What the round-1 test count hid

`fff-integration.test.ts` was 890 lines and the *only* file that registered `find`
or `grep`. Deleting it with the FFF plumbing left both tools untested — the count
went 384 → 288 and looked like "only style tests left", but 4 of those missing
tests were guarding two tools still in use. A per-file grep (`rg -l 'registerFindTool|registerGrepTool' test/`)
returns nothing before the added file; run that after any future slice delete.

### Next, in the order I would take them

| Priority | Slice | LOC removable | Tests removable | What is lost | Risk |
|---|---|---|---|---|---|
| ~~1~~ | ~~B4 `session-color.ts`~~ — **done**, 172 LOC, `session-color` test | 0 | 0 | nothing this repo rendered | Gates were `sessionAccent: false` *and* `stops: "theme"`; passing both also dropped the `sessionName` plumbing and the `session_info_changed` re-tint handler |
| ~~2~~ | ~~C1 `kitt` + `static` modes~~ — **decided: keep** (2026-10-27) | 0 | 0 | nothing | Not dead weight: the three modes are the feature. Dead *on this machine* is not the same as dead in the repo, and this repo is a template someone else copies. Cutting ~125 lines out of two shared `switch` bodies costs more review attention than it returns. |
| ~~3~~ | ~~A3 `tools/ls.ts`~~ — **done**, 129 LOC + 87 of icon table + `renderTree`/`isLsNotice` | 0 | 0 | nothing this repo rendered | The row undercounted. `DEFAULT_DISABLED_TOOLS` + `enableTools` kept it off, as predicted, but the cell's "`config/icons.ts` stays, it is shared" was **wrong**: `fileIcon`/`dirIcon` were imported only by `renderTree`, which only `ls` called. Real cost ≈ 260 LOC + the `icons`/`PRETTY_ICONS` keys |
| ~~4~~ | ~~B2 `user-rail.ts`~~ — **done**, 80 LOC, `user-rail` test | 0 | 0 | nothing this repo rendered | No `userRail` key in either config file, so `state` stayed `undefined` and the render wrapper was a passthrough — as predicted |
| 5 | B3 `prompt-editor.ts` | 111 | `prompt-editor` | the boxed prompt around live input | visible on every keystroke — decide, do not guess |

Rows 3 and 4 removed **≈ 340 LOC and 3 test files** without changing anything this
machine rendered. Slice 5 is the only one left with a visible cost.

Row 3 also disproved the table's own "free" logic in one place: a slice's LOC number is
only the module it names, so a shared-looking helper becomes dead weight the moment its
single caller goes. Grep the helper's importers, not its name, before trusting a row.

### Method note from round 1

The first version of this table ranked `claude-style.ts` as the cheapest cut
because it was "off by default" and "nothing in the current config" was lost.
That read the *code* default: `config/pi-pretty.json` — which `install.sh` copies
to `~/.pi/agent/pi-pretty.json` — set `toolStyle: "claudecode"`, so the style was
live on the only machine this repo boots. It was still the right slice to cut,
but it cost a visible change rather than none.

**So: open `config/pi-pretty.json` and `~/.pi/agent/pi-pretty.json` before trusting
any row in the table above.** Every row now names the config key that makes it free
or not — that check is the whole difference between a trim and a regression.

## What would change this answer

- `sessionAccent: true` gets turned on → slice 1 is a feature, not dead weight.
- `workingIndicator.mode` stays configurable on purpose (decided 2026-10-27: `kitt` and `static` stay), so do not re-propose C1 unless the modes stop being reachable from config.
- ~~`ls` gets enabled (it is one config key away) → slice 3 is a feature.~~ Re-adding `ls` now means restoring the module *and* the icon table it was the only consumer of; the `enableTools` key alone no longer buys a renderer.
- A future Pi version ships its own shimmer / `Loader` styling → C3 becomes duplicate work and should be re-evaluated before C1.

## Continuing on another machine

```bash
git switch main && git pull
cd extensions/pi-pretty && npx tsc --noEmit && npx vitest run   # 256 tests
cd ../.. && TMPDIR=$HOME/.cache/tmp node tests/run-all.mjs       # 10 repo suites
npx biome check extensions/pi-pretty/src/                        # 0 errors, 27 warnings
```

Deleting any slice means: remove the module, drop its config keys from
`pi-pretty.example.json` and `config/pi-pretty.json`, delete its tests, update
`extensions/pi-pretty/README.md` and the root `README.md`, then
`rsync -a --delete --exclude node_modules --exclude dist extensions/pi-pretty/ ~/.pi/agent/extensions/pi-pretty/`
and restart Pi (not just `/reload`: config is read at activation).
