---
status: completed
lane: normal
---
# Quiet startup: [Skill warnings] never comes back

## Goal
- outcome: A fresh `pi` start on this machine prints no `[Skill warnings]` block, and the duplication that produced 19 lines fails the test gate instead of reaching the screen.
- success_signal: `node tests/run-all.mjs` passes 11/11 with the new guard, `loadSkills` reports 0 diagnostics on this machine, and issue #26 is closed with that evidence.
- actors: the owner (Tui), who reads every startup screen on this machine; any machine bootstrapped from this repo.
- authority: issue #26 (symptom, repro, three routes); the owner's decisions on 2026-11-20 (route 1 plus docs, close locally); Pi 1.5.2 `dist/modes/interactive/interactive-mode.js`; `README.md` "Pi release fixes that matter here" (this setup carries no patches).
- requirements:
  - R1: `tests/test-skill-health.mjs` calls the same `loadSkills` Pi calls at startup and fails on any diagnostic, inside `node tests/run-all.mjs`. | acceptance: `node tests/run-all.mjs` → 11/11 | source: owner decision 2026-11-20 — guard, not configuration
  - R2: `README.md` explains why `quietStartup` never silences the block, names both duplication sources, points at the guard, and says the collapse belongs upstream. | acceptance: `rg -n '^## Skill warnings' README.md` and the counts in it match a live run | source: issue #26 acceptance list
  - R3: issue #26 is closed with the measured evidence rather than left open against an unreproducible symptom. | acceptance: `gh issue view 26 --json state -q .state` → `CLOSED` | source: owner decision 2026-11-20
- non-goals:
  - NG1: Patching `dist/modes/interactive/interactive-mode.js` or any file under `~/.pi/agent/install/<version>/node_modules/`. `README.md` states this setup carries no patches, and `showDiagnosticsWhenQuiet: true` is engine-side.
  - NG2: Implementing the upstream `startupDiagnostics: "off" | "summary" | "full"` setting. It is the right long-term fix and stays upstream.
  - NG3: Reaching into `loadedResourcesContainer` from an extension — it is private to `InteractiveMode`, and `ctx.ui.setHeader` only replaces `headerContainer`.
  - NG4: Keeping the duplicate consumer of skills alive by pruning individual skills from the sync. The bucket tree is the unit.

## Phases and Verification
- approach: silence the block by having nothing to report — clear the duplicate skill trees, then pin the empty-diagnostic state in the gate and document the sync. Rejected: a local patch (NG1) and a UI hack (NG3); deferred: the upstream setting (NG2).
- phase_slug: `main`
  status: done
  - goal: R1, R2, R3 | depends_on: none
  - surfaces: `tests/test-skill-health.mjs`, `README.md`, issue #26 | avoided: everything under `~/.pi/agent/install/`, `extensions/`, `config/`
  - phase check: `node tests/run-all.mjs` → 11/11, with `tests/test-skill-health.mjs` red-proved by injecting a duplicate skill and green after removing it

## Log

- 2026-11-20T01:38Z — main — decision — the symptom no longer reproduces: `loadSkills` reports `39 skills, 0 diagnostics` where issue #26 recorded `60 skills, 19 diagnostics`, and neither `~/.agents/skills/synced/` nor the second `tldraw-offline` exists. Route 1 was already satisfied by hand; the open work is the guard and the prose, not the deletion. Baseline: `7e938ec`.
- 2026-11-20T01:54Z — main/R2 — done — `README.md` gains `## Skill warnings`: why `quietStartup` cannot silence it (`showDiagnostics = showListing || showDiagnosticsWhenQuiet === true` at both call sites, `loadedResourcesContainer` private), the 18 collisions and the 1 conflict by name, the guard, and the upstream route. Counts quoted are the measured `39 skills / 0 diagnostics`. Surfaces: `README.md`.
- 2026-11-20T02:10Z — main — decision — absorb: guard tests/test-skill-health.mjs. R3 done: issue #26 closed 2026-11-20 with the 39-skills/0-diagnostics measurement and the red proof. The owner moved on to #25, so the single `pi` start this plan asked for is confirmed by the next session rather than held open.
- 2026-11-20T01:55Z — main — decision — the plan also carries the two NG5 items from the closed `tui-palette-contract` plan: they moved to issue #27 rather than being dropped at closure.

## Validation

### phase `main` — 2026-11-20T01:55Z
- mode: full
- judge: owner (2026-11-20) — the visual confirmation is a single `pi` start; the gate below is what the decision rested on
- gates: `node tests/run-all.mjs` → 11/11 files, including `test-skill-health.mjs` (394ms) and the red-proved duplicate-injection run
- verdict: APPROVED

## Current State and Next Action
- active_phase: none
- lifecycle_status: completed
- blockers: none
- open_items: none
- exact_next_action: none — initiative closed; issue #26 closed with measured evidence
