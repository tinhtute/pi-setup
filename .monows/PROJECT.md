# PROJECT — identity

## What is this project?
- The versioned Pi coding-agent setup for this machine: extensions, config templates, themes, an installer, and the vendored `pi-pretty` renderer fork.

## Who is it for?
- The owner (Tui) on a fresh machine, and every Pi session this machine runs.

## Non-goals
- Not a package registry, not a general Pi distribution, not a task tracker.
- Credentials, sessions, caches, trust decisions, and installed package directories never enter the repo.
- Not the mono harness itself: the SDLC skills and `zharness` live in `monoharness`; Claude Code specifics live in `monoclaudian`.

## What are the gate commands?
- run from: repository root unless the command says otherwise
- tests: `node tests/run-all.mjs` (all), `cd extensions/pi-pretty && npx vitest run` (fork)
- types: `cd extensions/pi-pretty && npx tsc --noEmit`
- lint: `cd extensions/pi-pretty && npx biome check src/`
- build: `cd extensions/pi-pretty && npx tsc`
- format: n/a (biome covers both check and fix)

## Architecture in one breath
- runtime shape: Pi loads TypeScript extensions from `~/.pi/agent/extensions/` through jiti; `setup/install.sh` syncs this repo into that tree, comparing before it copies and backing up whatever it overwrites.
- where state lives: `~/.pi/agent/{settings,models,pi-pretty}.json` are templates in `config/` and are never clobbered silently; provider credentials live only in `auth.json` and `~/.env`.
- entrypoints: `setup/install.sh` (machine), `extensions/*/index.ts` or `extensions/pi-pretty/src/index.ts` (runtime), `tests/run-all.mjs` (gate).

## What are we working on right now?
- plan: .monows/plans/active/tui-palette-contract.md (active)
