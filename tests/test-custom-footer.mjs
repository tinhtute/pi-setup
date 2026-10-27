// Run from the repo root: node tests/test-custom-footer.mjs
// For other install layouts: PI_NODE_MODULES=/path/to/node_modules node tests/test-custom-footer.mjs
//
// The expected strings are the byte sequences ~/.claude/statusline.sh emits for the equivalent
// Claude Code payload. Every assertion about color or spacing is therefore a parity assertion,
// not a restatement of this extension's own constants.
import assert from "node:assert/strict";
import { resolve } from "node:path";

import { jitiEntry, load, pkgFile, piAliases } from "./lib/pi-modules.mjs";

const { createJiti } = await load(jitiEntry);
const jiti = createJiti(import.meta.url, { alias: piAliases });
const mod = await jiti.import(resolve("extensions/custom-footer.ts"));
const extension = mod.default;
const { renderFooter } = mod;
const { visibleWidth } = await load(pkgFile("pi-tui", "dist/index.js"));
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");

const R = "\x1b[0m";
const DIM = "\x1b[38;5;247m";
const MODEL = "\x1b[38;5;208m";
const EFFORT = "\x1b[35m";
const TPM = "\x1b[93m";
const BRANCH = "\x1b[36m";
const GREEN = "\x1b[92m";
const YELLOW = "\x1b[93m";
const RED = "\x1b[91m";
const COLD = "\x1b[94m";
const SEP = " · ";

const weather = (used) => used >= 90 ? "↯" : used >= 75 ? "☇" : used >= 50 ? "☂" : used >= 25 ? "☁" : "☀";
// statusline.sh floors the percentage first (`:15`) and then does integer division (`:75`),
// so the helper must floor before dividing; floor(used*8/100) in one step would differ.
const cells = (used) => Math.min(8, Math.floor((Math.floor(used) * 8) / 100));
const bar = (used) => "━".repeat(cells(used)) + "─".repeat(8 - cells(used));
const ctxAnsi = (used) => used >= 75 ? RED : used >= 50 ? YELLOW : DIM;

// ---------------------------------------------------------------------------
// renderFooter is the planned seam: a pure function from a snapshot to the line.
// ---------------------------------------------------------------------------
const baseSnapshot = {
	model: "Opus 5.5",
	effort: "high",
	contextPercent: 0,
	tpmOutputTokens: 0,
	tpmDurationMs: 0,
	cache: { hit: undefined, expiresAt: undefined, misses: 0, lastMissAt: undefined, lastMissCause: undefined },
	branch: "main",
	now: Date.UTC(2026, 9, 6, 12),
};

for (const [percent, label] of [[0, "0"], [42, "42"], [null, "0"], [undefined, "0"]]) {
	const line = renderFooter({ ...baseSnapshot, contextPercent: percent, branch: null });
	const used = percent ?? 0;
	assert.equal(
		line,
		`${MODEL}👾 Opus 5.5${R}${SEP}${EFFORT}high${R}${SEP}${ctxAnsi(used)}${weather(used)}  ${bar(used)} ${Math.floor(used)}%${R}`,
		`context segment for percent=${JSON.stringify(percent)}`,
	);
}

// CC floors the percentage, then divides: the fill disagrees with rounding at these points.
for (const [value, expected] of [[6.25, 0], [7, 0], [12.5, 0], [43.75, 3], [56.25, 4], [68.75, 5], [93.75, 7], [100, 8], [-10, 0], [120, 8]]) {
	const clamped = Math.max(0, Math.min(100, value));
	const line = renderFooter({ ...baseSnapshot, contextPercent: value });
	assert(plain(line).includes(` ${bar(clamped)} `), `bar fill at ${value}`);
	assert.equal((plain(line).match(/━/g) ?? []).length, expected, `filled cells at ${value}`);
}

// Thresholds: 247 < 50 <= 93 < 75 <= 91, and the weather icon boundaries at 25/50/75/90.
for (const [value, ansi, icon] of [
	[0, DIM, "☀"], [24, DIM, "☀"], [25, DIM, "☁"], [49, DIM, "☁"],
	[50, YELLOW, "☂"], [74, YELLOW, "☂"], [75, RED, "☇"], [89, RED, "☇"], [90, RED, "↯"],
]) {
	const line = renderFooter({ ...baseSnapshot, contextPercent: value });
	assert(line.includes(`${ansi}${icon}  `), `context ${value} → ${icon} in ${ansi}`);
}

// R4: no effort level or "off" drops the whole segment and its separator.
for (const effort of [null, undefined, "", "off"]) {
	const line = renderFooter({ ...baseSnapshot, effort, branch: null });
	assert.equal(line, `${MODEL}👾 Opus 5.5${R}${SEP}${DIM}☀  ──────── 0%${R}`, `effort ${JSON.stringify(effort)} omitted`);
}

// R3: output-only tokens over summed API duration, CC's integer formatting.
for (const [output, durationMs, display] of [
	[999, 60000, "999"], [1000, 60000, "1.0k"], [2400, 60000, "2.4k"],
	[9999, 60000, "9.9k"], [10000, 60000, "10k"], [15000, 60000, "15k"],
	[2400, 120000, "1.2k"], [0, 60000, undefined], [1, 120000, undefined],
	[100, 0, undefined], [100, -60000, undefined], [100, undefined, undefined],
]) {
	const line = renderFooter({ ...baseSnapshot, tpmOutputTokens: output, tpmDurationMs: durationMs, branch: null, contextPercent: 0, effort: null });
	if (display === undefined) assert(!plain(line).includes("ϟ"), `tpm hidden for ${output}/${durationMs}`);
	else {
		assert(plain(line).includes(`${SEP}ϟ ${display} tpm`), `tpm ${output}/${durationMs} → ${display}`);
		assert(line.includes(`${TPM}ϟ${R} ${DIM}${display} tpm${R}`), "tpm uses ANSI 93 icon and dim value");
	}
}

// R1: full line, byte for byte, against what statusline.sh prints.
{
	const now = baseSnapshot.now;
	const line = renderFooter({
		...baseSnapshot,
		contextPercent: 42,
		tpmOutputTokens: 2400,
		tpmDurationMs: 60000,
		cache: { hit: 85, expiresAt: Math.floor(now / 1000) + 245, misses: 1, lastMissAt: now - 30000, lastMissCause: "ttl_expired" },
	});
	assert.equal(
		line,
		`${MODEL}👾 Opus 5.5${R}${SEP}${EFFORT}high${R}${SEP}${DIM}☁  ━━━───── 42%${R}` +
		`${SEP}${TPM}ϟ${R} ${DIM}2.4k tpm${R}` +
		`${SEP}${YELLOW}★ 85%${R} ${DIM}◷ 5m${R} ${YELLOW}✗1 idle${R}` +
		`${SEP}${BRANCH}⌥ main${R}`,
	);
}

// R5: cache segment — colors, TTL countdown, cold, and cause labels.
{
	const now = baseSnapshot.now;
	const at = (secs) => now + secs * 1000;
	for (const [hit, ansi] of [[100, GREEN], [90, GREEN], [89, YELLOW], [70, YELLOW], [69, RED], [1, RED], [0, RED]]) {
		const line = renderFooter({ ...baseSnapshot, branch: null, effort: null, cache: { hit, expiresAt: undefined, misses: 0, lastMissAt: undefined, lastMissCause: undefined } });
		assert(line.includes(`${SEP}${ansi}★ ${hit}%${R}`), `cache hit ${hit} → ${ansi}`);
	}
	// A hit rate is floored to a whole percent, like CC's `hit_ratio * 100 | floor`.
	{
		const line = renderFooter({ ...baseSnapshot, branch: null, effort: null, cache: { hit: 84.9, expiresAt: undefined, misses: 0, lastMissAt: undefined, lastMissCause: undefined } });
		assert(line.includes(`${YELLOW}★ 84%${R}`));
	}
	// TTL counts down in whole minutes, rounding up through the final partial minute.
	const nowSec = Math.floor(baseSnapshot.now / 1000);
	for (const [secs, display] of [[245, "5m"], [240, "4m"], [1, "1m"], [0, undefined], [-5, undefined]]) {
		const line = renderFooter({ ...baseSnapshot, branch: null, effort: null, cache: { hit: 50, expiresAt: nowSec + secs, misses: 0, lastMissAt: undefined, lastMissCause: undefined } });
		if (display === undefined) assert(line.includes(`${COLD}❄ cold${R}`), `cold at ${secs}`);
		else assert(line.includes(`${DIM}◷ ${display}${R}`), `ttl ${secs} → ${display}`);
	}
	// Misses: count, cause label, the idle/yellow rule, and the 10-minute freshness decay to dim.
	for (const [cause, label, ansi] of [
		["ttl_expired", "idle", YELLOW], ["tools_changed", "tools", RED],
		["system_prompt_changed", "sys", RED], ["likely_server_side", "server", RED],
		["unknown", "unknown", RED],
	]) {
		const line = renderFooter({ ...baseSnapshot, branch: null, effort: null, now: at(0), cache: { hit: 50, expiresAt: undefined, misses: 3, lastMissAt: now - 60000, lastMissCause: cause } });
		assert(line.includes(` ${ansi}✗3 ${label}${R}`), `miss cause ${cause} → ✗3 ${label}`);
	}
	{
		const stale = renderFooter({ ...baseSnapshot, branch: null, effort: null, now: at(0), cache: { hit: 50, expiresAt: undefined, misses: 2, lastMissAt: now - 601000, lastMissCause: "tools_changed" } });
		assert(stale.includes(` ${DIM}✗2${R}`), "a miss older than 10 minutes loses its label and turns dim");
		assert(!plain(stale).includes("tools"));
	}
	{
		const noMiss = renderFooter({ ...baseSnapshot, branch: null, effort: null, cache: { hit: 50, expiresAt: undefined, misses: 0, lastMissAt: undefined, lastMissCause: undefined } });
		assert(!plain(noMiss).includes("✗"));
	}
	// No observed caching at all: no cache segment whatsoever.
	{
		const line = renderFooter({ ...baseSnapshot, branch: null, effort: null, cache: baseSnapshot.cache });
		assert(!plain(line).includes("★") && !plain(line).includes("❄"));
	}
}

// R6: branch color, and no branch segment outside a repository.
assert(renderFooter(baseSnapshot).includes(`${BRANCH}⌥ main${R}`));
assert(!plain(renderFooter({ ...baseSnapshot, branch: null })).includes("⌥"));

// Control characters in a branch name must never reach the terminal.
{
	const line = renderFooter({ ...baseSnapshot, branch: "feat/\x1b[31mevil\x07" });
	assert(!line.includes("\x07"));
	assert(plain(line).includes("⌥ feat/"));
}

// ---------------------------------------------------------------------------
// The extension wires the snapshot to live Pi data; these tests drive it through
// the real ExtensionAPI surface with a fixture session.
// ---------------------------------------------------------------------------
// Fake timers are installed before any harness runs, so a leaked real 30s interval can never
// keep the test process alive or fire mid-assertion. A cleared tick becomes an inert function.
const intervals = new Map();
const realSet = globalThis.setInterval;
const realClear = globalThis.clearInterval;
let nextId = 1;
globalThis.setInterval = (fn, ms) => {
	const entry = { fn, ms, cleared: false };
	entry.fn = () => { if (!entry.cleared) fn(); };
	const id = nextId++;
	intervals.set(id, entry);
	return id;
};
globalThis.clearInterval = (id) => {
	const entry = intervals.get(id);
	if (entry) entry.cleared = true;
};

try {
	const assistant = (usage, extra = {}) => ({
		type: "message",
		id: `e${Math.random()}`,
		message: { role: "assistant", usage, durationMs: usage.durationMs, timestamp: usage.timestamp, responseId: usage.responseId, ...extra },
	});

async function harness({ promptCache = { short: 300, long: 3600 } } = {}) {
	const events = new Map();
	const commands = new Map();
	let thinking = "high";
	// `null` means "this model declares no cache lifetime", which is the realistic default:
	// no provider in models-store.json sets promptCache today.
	const model = { name: "Opus 5.5", id: "opus", reasoning: true, promptCache: promptCache ?? undefined };
	const pi = {
		on(name, handler) {
			if (!events.has(name)) events.set(name, new Set());
			events.get(name).add(handler);
			return () => events.get(name).delete(handler);
		},
		registerCommand: (name, command) => commands.set(name, command),
		getThinkingLevel: () => thinking,
	};
	extension(pi);
	const state = {
		header: undefined, percent: 0, branch: "main", renders: 0, footerCalls: 0,
		entries: [], leaf: 0, branchReads: 0, sessionReads: 0, sessionId: "test-session",
		allEntries: [], sessionHeader: null, model,
	};
	const branchListeners = new Set();
	const ctx = {
		mode: "tui",
		get model() { return state.model; },
		getContextUsage: () => state.percent === undefined ? undefined : { percent: state.percent },
		sessionManager: {
			getSessionId: () => state.sessionId,
			getLeafId: () => String(state.leaf),
			getBranch: () => { state.branchReads++; return state.entries; },
			getEntries: () => { state.sessionReads++; return state.allEntries; },
			getHeader: () => state.sessionHeader,
		},
		ui: {
			setFooter(factory) {
				state.footerCalls++;
				state.header?.dispose();
				state.header = factory?.({ requestRender: () => state.renders++ }, undefined, {
					getGitBranch: () => state.branch,
					onBranchChange(handler) {
						branchListeners.add(handler);
						return () => branchListeners.delete(handler);
					},
				});
			},
			notify() {},
		},
	};
	const emit = async (name, event = {}) => {
		for (const handler of [...(events.get(name) ?? [])]) await handler(event, ctx);
	};
	return { pi, ctx, state, emit, commands, branchListeners, setThinking: (v) => { thinking = v; } };
}

	const h = await harness();
	await h.emit("session_start");
	const text = () => plain(h.state.header.render(120)[0]);
	assert.equal(h.state.footerCalls, 1);
	assert.equal(text(), "👾 Opus 5.5 · high · ☀  ──────── 0% · ⌥ main");
	assert(visibleWidth(h.state.header.render(120)[0]) <= 120);

	// Percent and bar come from ctx.getContextUsage(); the fixture's nulls collapse to 0%.
	for (const [value, icon] of [[0, "☀"], [25, "☁"], [50, "☂"], [75, "☇"], [90, "↯"]]) {
		h.state.percent = value;
		assert(text().includes(`${icon}  `), `live percent ${value}`);
	}
	h.state.percent = undefined;
	assert(text().includes("☀  ──────── 0%"), "unknown live context renders as 0%");

	// Widths never overflow, and the footer stays a single line.
	for (const width of [0, 1, 10, 20, 40, 80, 120]) {
		const lines = h.state.header.render(width);
		assert.equal(lines.length, 1);
		assert(visibleWidth(lines[0]) <= width, `width ${width}`);
	}

	// TPM: output tokens over summed durationMs, excluding auxiliary usage entries.
	// 600 input/output split must contribute only the 600 output tokens.
	h.state.entries = [assistant({ input: 600, output: 600, cacheRead: 0, cacheWrite: 0, durationMs: 60000 }), { type: "usage", usage: { input: 100, output: 900, durationMs: 999 } }];
	h.state.leaf++;
	assert(text().includes("ϟ 600 tpm"), `tpm from output only, got: ${text()}`);
	// Duplicate responses (same responseId) must not be double counted.
	h.state.entries = [
		assistant({ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, durationMs: 30000, responseId: "dup" }),
		assistant({ input: 0, output: 300, cacheRead: 0, cacheWrite: 0, durationMs: 30000, responseId: "dup" }),
	];
	h.state.leaf++;
	assert(text().includes("ϟ 600 tpm"), "duplicate responseId counted once");

	// Cache hit and TTL come from the latest assistant message on the branch.
	const nowMs = Date.UTC(2026, 9, 6, 12);
	const realNow = Date.now;
	try {
		Date.now = () => nowMs;
		h.state.entries = [assistant({ input: 15, output: 50, cacheRead: 85, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 60000 })];
		h.state.leaf++;
		assert(text().includes("★ 85%"), "cache hit from branch usage");
		assert(text().includes("◷ 4m"), `short-tier TTL countdown, got: ${text()}`);

		// A 1h write selects the long tier, so the countdown reflects it.
		h.state.entries = [assistant({ input: 15, output: 50, cacheRead: 85, cacheWrite: 2000, cacheWrite1h: 2000, durationMs: 1000, timestamp: nowMs - 60000 })];
		h.state.leaf++;
		assert(text().includes("◷ 59m"), `long-tier TTL countdown, got: ${text()}`);

		// No declared lifetime: hit rate stays, countdown becomes cold.
		const noTtl = await harness({ promptCache: null });
		await noTtl.emit("session_start");
		Date.now = () => nowMs;
		noTtl.state.entries = [assistant({ input: 15, output: 50, cacheRead: 85, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 1000 })];
		noTtl.state.leaf++;
		const line = plain(noTtl.state.header.render(120)[0]);
		assert(line.includes("★ 85%"), "hit rate survives without a TTL");
		assert(line.includes("❄ cold"), `no lifetime → cold, got: ${line}`);
		await noTtl.emit("session_shutdown");

		// A material prefix shrink is a miss; a shrink under the threshold is not.
		// 10000 -> 4900 loses 51%; 10000 -> 6000 loses 40% and 10000 -> 5000 loses exactly
		// half; only "more than half" counts, so the last two stay cache hits.
		for (const [after, missed] of [[4900, true], [5000, false], [6000, false]]) {
			h.state.entries = [
				assistant({ input: 100, output: 10, cacheRead: 10000, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 120000 }),
				assistant({ input: 12000, output: 10, cacheRead: after, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 60000 }),
			];
			h.state.leaf++;
			if (missed) assert(text().includes("✗1"), `10000 → ${after} is a miss, got: ${text()}`);
			else assert(!text().includes("✗"), `10000 → ${after} stays cached, got: ${text()}`);
		}
		h.state.entries = [
			assistant({ input: 100, output: 10, cacheRead: 10000, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 120000 }),
			assistant({ input: 12000, output: 10, cacheRead: 500, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 60000 }),
		];
		h.state.leaf++;
		assert(text().includes("✗1"), `material shrink is a miss, got: ${text()}`);
		// The same shrink announced by a compaction is a rebuild, not a miss.
		h.state.entries = [
			assistant({ input: 100, output: 10, cacheRead: 10000, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 120000 }),
			{ type: "compaction", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
			assistant({ input: 600, output: 10, cacheRead: 800, cacheWrite: 0, durationMs: 1000, timestamp: nowMs - 60000 }),
		];
		h.state.leaf++;
		assert(!text().includes("✗"), "a shrink explained by compaction is not a miss");
	} finally {
		Date.now = realNow;
	}

	// Branch changes and invalidate() re-render; subscriptions are released on dispose.
	h.state.branch = "feat/x";
	const before = h.state.renders;
	for (const listener of h.branchListeners) listener();
	assert(h.state.renders > before, "branch change requests a render");
	assert(text().includes("⌥ feat/x"));
	h.state.branch = null;
	assert(!plain(h.state.header.render(120)[0]).includes("⌥"));
	h.state.branch = "main";

	// R7: a 30s timer re-renders, and session_shutdown clears it.
	// The fake honours clearInterval by making a cleared tick a no-op, which is what the real
	// timer does; otherwise the assertion would be about the fake rather than the extension.
	assert.equal(intervals.size > 0, true, "a live session arms a render timer");
	const live = [...intervals.entries()].filter(([, t]) => !t.cleared);
	assert.equal(live.length, 1, "exactly one tick is live after re-installing the footer");
	const [, timer] = live[0];
	assert.equal(timer.ms, 30000, "interval matches Claude Code's refreshInterval of 30s");
	const seen = h.state.renders;
	timer.fn();
	assert(h.state.renders > seen, "the timer requests a render");
	await h.emit("session_shutdown");
	assert.equal([...intervals.values()].filter((t) => !t.cleared).length, 0, "session_shutdown clears every armed tick");
	const after = h.state.renders;
	timer.fn();
	assert.equal(h.state.renders, after, "a cleared timer no longer renders");

	// Commands still switch between this footer and Pi's own.
	assert(h.commands.has("custom-footer"));
	assert(h.commands.has("builtin-footer"));
	{
		const calls = h.state.footerCalls;
		await h.commands.get("custom-footer").handler("", h.ctx);
		assert.equal(h.state.footerCalls, calls + 1, "/custom-footer re-installs the footer");
		await h.commands.get("builtin-footer").handler("", h.ctx);
		assert(h.state.footerCalls > calls + 1, "/builtin-footer restores Pi's footer");
	}

	// Non-TUI modes must not touch the footer at all.
	{
		const quiet = await harness();
		quiet.ctx.mode = "json";
		await quiet.emit("session_start");
		assert.equal(quiet.state.footerCalls, 0, "no footer outside TUI mode");
	}
	await h.emit("session_shutdown");
} finally {
	globalThis.setInterval = realSet;
	globalThis.clearInterval = realClear;
}

process.stdout.write("PASS cc-parity layout, colors, thresholds, tpm, cache ledger, timer, commands\n");
