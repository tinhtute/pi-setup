---
status: active
lane: normal
---
# TUI palette contract

## Goal
- outcome: The TUI layer renders from one accent the Pi theme owns — code blocks, working shimmer, footer, confirm box, and reply pills all derive from the active theme instead of five independent hardcoded palettes — and the vendored `pi-pretty` fork typechecks and tests against the SDK this machine actually runs.
- success_signal: `node tests/run-all.mjs` passes with new assertions that pin the single-accent contract, and a live Pi session shows syntax-highlighted reads, the working shimmer, the footer, and reply pills in the same colour family as the active theme.
- actors: the owner (Tui), who reads every Pi session on this machine; any fresh machine bootstrapped from this repo.
- authority: the owner's decisions on 2026-11-19 (renderer, palette, emphasis; a skill adoption that the licence check then dropped); `docs/pi-pretty-feature-inventory.md`; upstream pi-pretty CHANGELOG 0.10.0; Pi 1.5.2 `docs/tui.md` and `docs/themes.md`.
- requirements:
  - R1: `extensions/pi-pretty` typechecks, lints, and passes its suite against the Pi 1.5.x SDK instead of the pinned 1.3.0, with no renderer behaviour dropped to get there. | acceptance: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run`, then `node tests/test-palette-theme.mjs` | source: owner decision — keep the fork, bump the SDK
  - R2: `config/pi-pretty.json` names a valid bundled Shiki theme (`catppuccin-mocha`, 65 bundled names available) so code blocks stop falling back to `github-dark` while the TUI runs Pi's `system` theme; a missing or non-bundled name fails the gate. | acceptance: `node tests/test-palette-theme.mjs && node tests/run-all.mjs` | source: pi-pretty CHANGELOG 0.6.23 fallback rule; CHANGELOG 0.10.0 `theme` precedence
  - R3: `custom-footer.ts` and `confirm-guard/box.ts` take status colours from named theme tokens (`accent`, `success`, `warning`, `error`, `muted`, `dim`, `text`) through one shared helper, and keep their segment structure and thresholds; no `\x1b[38;5;…]` status literal and no `#56a2c7` accent exception survive. | acceptance: `node tests/test-custom-footer.mjs && node tests/test-confirm-guard.mjs` | source: owner decision — one accent from the Pi theme
  - R4: `config/settings.json` pins `pi-emphasis` to an immutable ref, README records it as an external TUI dependency, and the pin format is enforced by a test. | acceptance: `node tests/run-all.mjs` | source: owner decision — pin the git ref, do not vendor
  - R5: The reply-style contract has one documented home: README states that `pi-emphasis` supplies it, and no 0-byte `AGENTS.md` ships or gets installed. | acceptance: `node tests/run-all.mjs` | source: live `~/.pi/agent/AGENTS.md` is 0 bytes while the contract arrives from the extension
- non-goals:
  - NG1: Taking upstream's `claudecode` tool style, or re-vendoring pi-pretty 0.10.0 — the fork stays the maintenance surface.
  - NG2: Changing `custom-banner.ts` — its fixed rainbow is a signature and is already pinned by `tests/test-palette-theme.mjs`.
  - NG3: Vendoring `pi-emphasis` into `extensions/`.
  - NG4: Changing what this repository is — it stays the Pi machine setup, not a Pi port of the mono harness.
  - NG5: The `themes/cyan.json` fate and the live versus template drift in default provider/model, thinking level, and `steeringMode` — both are outside the TUI layer and stay open items.
  - NG6: Installing `pi-plugin-dev`. Its source (`fredcamaral/drawers`) ships no licence, so it stays a reading reference, recorded in `README.md`, and R6 was dropped with the owner's approval on 2026-11-19.

## Phases and Verification
- approach: keep the vendored fork and make the active Pi theme the single accent source; rejected: re-vendoring upstream 0.10.0 for its `claudecode` style, which buys row shape at roughly 2.5k extra LOC and 125 extra tests.
- phase_slug: `main`
  status: checked
  - goal: R1, R2, R3, R4, R5 | depends_on: none
  - surfaces: `extensions/pi-pretty/{package.json,src/config*,src/indicator/*}`, `extensions/custom-footer.ts`, `extensions/confirm-guard/box.ts`, `config/{pi-pretty,settings}.json`, `tests/{test-palette-theme,test-custom-footer,test-confirm-guard,run-all}.mjs`, `README.md`, `docs/pi-pretty-feature-inventory.md` | avoided: `extensions/custom-banner.ts`, `themes/`, `setup/install.sh` sync logic, every credential path
  - phase check: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run`; `node tests/run-all.mjs`; then exercise one live Pi session and compare the read block, shimmer, footer, and a reply pill side by side

## Log

- 2026-11-19T16:01Z — main — start — phase `main` set in-progress: R1 vendor SDK bump, R2 Shiki theme, R3 one accent register, R4 pi-emphasis pin, R5 reply-style home, R6 pi-plugin-dev. Baseline at HEAD `211c9df` with the owner's uncommitted `rpiv-todo` → `@tintinweb/pi-tasks` swap in the tree.
- 2026-11-19T16:01Z — main — decision — baseline: 211c9df `node tests/run-all.mjs` rc=0 (10/10 files). The dirty tree is the owner's `npm:@juicesharp/rpiv-todo` → `npm:@tintinweb/pi-tasks` rename across `config/settings.json`, `setup/install.sh`, two tests, `README.md`; it is preserved as-is and R4's pin is added on top of it.

- 2026-11-19T16:05Z — main/R1 — done — `extensions/pi-pretty` devDependencies moved 1.3.0 → 1.5.2 to match the host `pi 1.5.2`. Check: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run` → tsc rc=0, biome 0 errors / 22 warnings (the round-4 count), 256 tests across 21 files. `node tests/test-palette-theme.mjs` → ok. Source: HEAD `211c9df` + dirty diff/untracked hash `ad8d8d8a26f78754`. Surfaces: `extensions/pi-pretty/{package.json,package-lock.json}`; no `src/` file changed.
- 2026-11-19T16:05Z — main/R2 — done — `config/pi-pretty.json` now names `theme: "catppuccin-mocha"` (bundled Shiki, mauve next to the generated `system` accent). Red first: the new assertion failed on the live file with `live: pi-pretty.json must name a Shiki theme`; green after the template and `~/.pi/agent/pi-pretty.json` (backup `pi-pretty.json.backup.20261119_230245`) carried the key. Check: `node tests/test-palette-theme.mjs` → ok. Source: same tree hash. Surfaces: `config/pi-pretty.json`, `tests/test-palette-theme.mjs` (new section 1b), live config.
- 2026-11-19T16:05Z — main/R3 — done — one accent register: `extensions/tui-palette/{palette.ts,index.ts}` owns the token vocabulary, `levelToken`, and the accent-vs-border contrast rule; `custom-footer.ts` paints every segment through it and takes the theme from `setFooter`'s second argument; `confirm-guard/box.ts` drops its local `luminance`/`emphasis` rule and imports `emphasis`. Red first: `node tests/test-custom-footer.mjs` failed with a plain line where escapes were expected, because the footer no longer carries its own ANSI table. Check: `node tests/test-custom-footer.mjs` → PASS (every old byte assertion now resolves through a fake theme's slots, plus new slot assertions and a no-theme fallback), `node tests/test-confirm-guard.mjs` → PASS. Source: same tree hash. Surfaces: `extensions/custom-footer.ts`, `extensions/confirm-guard/box.ts`, `extensions/tui-palette/`, `tests/test-custom-footer.mjs`, `tests/test-palette-theme.mjs` (surface scan).
- 2026-11-19T16:05Z — main/R4 — done — `config/settings.json` and the live `~/.pi/agent/settings.json` (backup `settings.json.backup.20261119_230446`) pin `git:github.com/johnlindquist/pi-emphasis@f884b736c489944ee778ab951c7f78580f137b02`, the commit already checked out. Red proof: the new pin pattern rejects the previous unpinned `git:…/pi-emphasis` source and accepts the 40-hex ref. Check: `node tests/test-package-selection.mjs` → PASS. Source: same tree hash. Surfaces: `config/settings.json`, `tests/test-package-selection.mjs`, live settings.
- 2026-11-19T16:05Z — main/R5 — done — docs-only: README records pi-emphasis as the one unvendored TUI dependency, states that it supplies the reply contract, records the 0-byte `AGENTS.md` history, and rewrites the footer/Shiki paragraphs that the palette change made false. Check: `node tests/run-all.mjs` → 10/10 files pass, including the new assertions that the repo ships no `AGENTS.md` and `install.sh` never mentions one. Source: same tree hash. Surfaces: `README.md`, `docs/pi-pretty-feature-inventory.md`.
- 2026-11-19T16:05Z — main/R6 — blocked — gate: authority boundary. `fredcamaral/drawers`, the source of `pi-plugin-dev`, ships **no licence** (GitHub API reports `license: None`; the sparse clone has no LICENSE/COPYING file), so copying its `SKILL.md` + 8 reference files into `~/.agents/skills/` is not a call this agent may make. failure_class: MISSING_CONTEXT. Next action: the owner picks one of the three routes in the question below.
- 2026-11-19T16:07Z — main — decision — R6 dropped, not deferred: the owner chose "bỏ R6, chỉ ghi link tham khảo" after the licence check. `## Goal` now carries R1–R5, the requirement moved to NG6, and `README.md` records the drawers skill as a reading reference only. Gate re-run after the docs edit: `node tests/run-all.mjs` → 10/10.
- 2026-11-19T16:07Z — main — decision — the live exercise the phase check asks for is not reproducible from inside a session: the TUI surfaces are exercised through jiti against the real `ExtensionAPI` and a fake theme (all assertions above), but the visual comparison of read block, shimmer, footer and a pill needs a Pi restart by the owner. Recorded as a limitation, not a pass.

## Validation

## Current State and Next Action
- active_phase: main
- lifecycle_status: checked
- blockers: none
- open_items: `themes/cyan.json` is installed but never selected (`theme: "system"`) — remove it or adopt it; template `config/settings.json` still says hive/1.4.0/high while the machine runs mistral/1.5.2/max with `steeringMode: all`
- exact_next_action: `handoff` — close the plan once the owner restarts Pi and confirms the read block, shimmer, footer and pills share the theme's accent family
