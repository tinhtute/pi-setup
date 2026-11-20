---
status: completed
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
  status: done
  - goal: R1, R2, R3, R4, R5 | depends_on: none
  - surfaces: `extensions/pi-pretty/{package.json,src/config*,src/indicator/*}`, `extensions/custom-footer.ts`, `extensions/confirm-guard/box.ts`, `config/{pi-pretty,settings}.json`, `tests/{test-palette-theme,test-custom-footer,test-confirm-guard,run-all}.mjs`, `README.md`, `docs/pi-pretty-feature-inventory.md` | avoided: `extensions/custom-banner.ts`, `themes/`, `setup/install.sh` sync logic, every credential path
  - phase check: `cd extensions/pi-pretty && npx tsc --noEmit && npx biome check src/ && npx vitest run`; `node tests/run-all.mjs`; then exercise one live Pi session and compare the read block, shimmer, footer, and a reply pill side by side

## Log

- 2026-11-19T16:01Z — main — decision — baseline: 211c9df `node tests/run-all.mjs` rc=0 (10/10 files). The dirty tree is the owner's `npm:@juicesharp/rpiv-todo` → `npm:@tintinweb/pi-tasks` rename across `config/settings.json`, `setup/install.sh`, two tests, `README.md`; it is preserved as-is and R4's pin is added on top of it.

- 2026-11-19T16:05Z — main/R6 — blocked — gate: authority boundary. `fredcamaral/drawers`, the source of `pi-plugin-dev`, ships **no licence** (GitHub API reports `license: None`; the sparse clone has no LICENSE/COPYING file), so copying its `SKILL.md` + 8 reference files into `~/.agents/skills/` is not a call this agent may make. failure_class: MISSING_CONTEXT. Next action: the owner picks one of the three routes in the question below.
- 2026-11-19T16:07Z — main — decision — R6 dropped, not deferred: the owner chose "bỏ R6, chỉ ghi link tham khảo" after the licence check. `## Goal` now carries R1–R5, the requirement moved to NG6, and `README.md` records the drawers skill as a reading reference only. Gate re-run after the docs edit: `node tests/run-all.mjs` → 10/10.
- 2026-11-19T16:07Z — main — decision — the live exercise the phase check asks for is not reproducible from inside a session: the TUI surfaces are exercised through jiti against the real `ExtensionAPI` and a fake theme (all assertions above), but the visual comparison of read block, shimmer, footer and a pill needs a Pi restart by the owner. Recorded as a limitation, not a pass.
- 2026-11-20T01:43Z — main — decision — absorb: guard tests/test-palette-theme.mjs. Closing on the owner's 2026-11-20 instruction, which waived the visual pass the previous entry asked for. The close re-ran every gate at `7e938ec` and the live-config guard fired: `~/.pi/agent/pi-pretty.json` had lost `theme`, so `test-palette-theme.mjs` failed with `live: pi-pretty.json must name a Shiki theme`. Backup `pi-pretty.json.backup.20261120_084305`, key restored, gate green. That is the R2 failure class caught by the guard rather than by the owner, so the guard — not this plan — is what keeps it from returning. The two NG5 items moved to #27 rather than being dropped.

## Validation

### phase `main` — 2026-11-20T01:43Z
- mode: full
- judge: owner (2026-11-20) — the visual comparison of read block, shimmer, footer and pill stays unconfirmed by design; the owner waived it when instructing the close
- gates: `cd extensions/pi-pretty && npx tsc --noEmit` rc=0 · `npx biome check src/` 0 errors / 22 warnings · `npx vitest run` 256/256 across 21 files · `node tests/run-all.mjs` 10/10 files
- drift: live `pi-pretty.json` had lost the Shiki `theme` key since the 2026-11-19 run; restored before the gate, which then passed
- verdict: APPROVED

## Current State and Next Action
- active_phase: none
- lifecycle_status: completed
- blockers: none
- open_items: none
- exact_next_action: none — initiative closed; the residual `themes/cyan.json` fate and the live-versus-template settings drift were carried into issue #27
