#!/usr/bin/env node
// Guard: a quiet start has no [Skill warnings] block.
//
// Pi paints that block under the banner when `loadSkills` reports diagnostics, and it
// paints it even with `quietStartup: true` — the setting only silences the
// `[Skills]`/`[Extensions]` listing. So the block is silenced by having nothing to
// report, not by configuration.
//
// What made it 19 lines here (issue #26) was duplicated skill trees:
//   - `~/.agents/skills/synced/<uuid>_<uuid>/` carried nine skills twice -> 18 collisions
//   - `tldraw-offline` sat in both `~/.pi/agent/skills` and `~/.agents/skills` -> 1 conflict
// The external sync drops those bucket trees back in, so this test is the thing that
// notices before the next start spends 19 lines on it.
//
//   node tests/test-skill-health.mjs
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { load, piAgentEntry } from "./lib/pi-modules.mjs";

const pi = await load(piAgentEntry);
const loadSkills = pi.loadSkills;
if (typeof loadSkills !== "function") {
	throw new Error("pi dist/index.js no longer exports loadSkills; this guard needs a new hook");
}

const home = homedir();
const agentDir = join(home, ".pi/agent");
const shared = join(home, ".agents/skills");

// Pi is told about a path that does not exist on a fresh machine, so only pass roots
// that are really there; a missing root would itself be a diagnostic.
const skillPaths = existsSync(shared) ? [shared] : [];
const result = loadSkills({ cwd: home, agentDir, includeDefaults: true, skillPaths });

const diagnostics = result.diagnostics ?? [];
if (diagnostics.length > 0) {
	const lines = diagnostics.map((d) => `  ${d.type ?? "warning"} ${d.path ?? "?"}: ${d.message}`);
	const buckets = existsSync(join(shared, "synced"))
		? readdirSync(join(shared, "synced"), { withFileTypes: true }).filter((e) => e.isDirectory()).length
		: 0;
	throw new assert.AssertionError({
		message: [
			`[Skill warnings] would print ${diagnostics.length} line(s) at startup:`,
			...lines,
			"",
			"Duplicates are reported as name collisions between skill roots. With a synced",
			`tree present (${buckets} bucket dir(s) under ${shared}/synced), drop the duplicate`,
			"bucket and remove the second copy of any skill that lives in two roots:",
			`  rm -rf ${shared}/synced/<uuid>_<uuid>`,
			"Then re-run this file until it reports 0 diagnostics.",
		].join("\n"),
	});
}

console.log(
	`ok: ${result.skills.length} skills across ${[agentDir, ...skillPaths].length} root(s), 0 diagnostics — startup stays quiet`,
);
