import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

// Compact footer that reproduces the segment structure, thresholds and colors of
// ~/.claude/statusline.sh. Colors are fixed ANSI, not theme tokens: that script hardcodes
// them, and the owner asked for byte-level parity rather than theme adaptation.
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

const BAR_CELLS = 8;
const REFRESH_MS = 30000;
const MISS_LABEL_FRESH_MS = 600000;
// A prefix counts as a miss only when it loses more than half its cached tokens. CC's ledger
// says "materially shrank" without publishing a number, so this threshold is our heuristic and
// both sides of it are pinned by tests: 10000 -> 4900 is a miss, 10000 -> 6000 is not.
const MATERIAL_SHRINK = 0.5;

export interface CacheSnapshot {
	/** Whole-percent hit ratio of the latest assistant response, or undefined when unobserved. */
	hit: number | undefined;
	/** Seconds after `now` when the cached prefix expires; undefined means no declared lifetime. */
	expiresAt: number | undefined;
	misses: number;
	/** Epoch milliseconds of the most recent miss, or undefined. */
	lastMissAt: number | undefined;
	lastMissCause: string | undefined;
}

export interface FooterSnapshot {
	model: string;
	effort: string | null | undefined;
	contextPercent: number | null | undefined;
	/** Output tokens of assistant messages on the branch, deduplicated by response id. */
	tpmOutputTokens: number;
	/** Summed assistant `durationMs`, in milliseconds. */
	tpmDurationMs: number;
	cache: CacheSnapshot;
	branch: string | null;
	/** Epoch milliseconds; injected so the countdown is testable. */
	now: number;
}

/** Labels a cache miss cause the way CC's `case` statement does. */
function causeLabel(cause: string | undefined): string {
	if (!cause) return "";
	if (cause.startsWith("ttl_expired")) return "idle";
	if (cause === "tools_changed") return "tools";
	if (cause === "system_prompt_changed") return "sys";
	if (cause === "likely_server_side") return "server";
	return cause.replace(/_changed$/, "");
}

function weatherIcon(used: number): string {
	if (used >= 90) return "↯";
	if (used >= 75) return "☇";
	if (used >= 50) return "☂";
	if (used >= 25) return "☁";
	return "☀";
}

function contextAnsi(used: number): string {
	if (used >= 75) return RED;
	if (used >= 50) return YELLOW;
	return DIM;
}

/** CC's fill arithmetic is `floor(used * 8 / 100)` where `used` was already floored, capped at 8 cells. */
function contextBar(used: number): string {
	const filled = Math.min(BAR_CELLS, Math.floor((used * BAR_CELLS) / 100));
	return "━".repeat(filled) + "─".repeat(BAR_CELLS - filled);
}

/** CC's formatting: `999`, `1.0k`, `10k`. */
function formatTpm(tpm: number): string {
	if (tpm >= 10000) return `${Math.floor(tpm / 1000)}k`;
	if (tpm >= 1000) return `${Math.floor(tpm / 1000)}.${Math.floor((tpm % 1000) / 100)}k`;
	return String(tpm);
}

// Model and branch names are labels, never terminal control sequences.
function label(text: string): string {
	return text.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

/** Pure render of one footer line. Every segment mirrors `statusline.sh`. */
export function renderFooter(snapshot: FooterSnapshot): string {
	// CC's jq reads `used_percentage // 0`, so an unknown percentage prints as 0%.
	const raw = typeof snapshot.contextPercent === "number" && Number.isFinite(snapshot.contextPercent)
		? snapshot.contextPercent
		: 0;
	const used = Math.max(0, Math.min(100, Math.floor(raw)));
	let out = `${MODEL}👾 ${label(snapshot.model)}${R}`;

	// CC omits the effort segment when `.effort.level` is absent; "off" means no effort too.
	const effort = snapshot.effort;
	if (effort && effort !== "off") out += `${SEP}${EFFORT}${label(effort)}${R}`;

	out += `${SEP}${contextAnsi(used)}${weatherIcon(used)}  ${contextBar(used)} ${used}%${R}`;

	if (Number.isFinite(snapshot.tpmOutputTokens) && snapshot.tpmOutputTokens > 0
		&& Number.isFinite(snapshot.tpmDurationMs) && snapshot.tpmDurationMs > 0) {
		const tpm = Math.floor((snapshot.tpmOutputTokens * 60000) / snapshot.tpmDurationMs);
		if (tpm > 0) out += `${SEP}${TPM}ϟ${R} ${DIM}${formatTpm(tpm)} tpm${R}`;
	}

	const cache = snapshot.cache;
	if (cache.hit !== undefined && Number.isFinite(cache.hit)) {
		const hit = Math.floor(Math.max(0, Math.min(100, cache.hit)));
		const ansi = hit >= 90 ? GREEN : hit >= 70 ? YELLOW : RED;
		out += `${SEP}${ansi}★ ${hit}%${R}`;

		const nowSec = Math.floor(snapshot.now / 1000);
		const expiresAt = cache.expiresAt;
		if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > nowSec) {
			out += ` ${DIM}◷ ${Math.floor((expiresAt - nowSec + 59) / 60)}m${R}`;
		} else {
			out += ` ${COLD}❄ cold${R}`;
		}

		if (cache.misses > 0) {
			let ansi = RED;
			let suffix = "";
			if (typeof cache.lastMissAt === "number" && snapshot.now - cache.lastMissAt < MISS_LABEL_FRESH_MS) {
				const cause = causeLabel(cache.lastMissCause);
				if (cause) suffix = ` ${cause}`;
				if (cache.lastMissCause?.startsWith("ttl_expired")) ansi = YELLOW;
			} else {
				ansi = DIM;
			}
			out += ` ${ansi}✗${cache.misses}${suffix}${R}`;
		}
	}

	if (snapshot.branch) out += `${SEP}${BRANCH}⌥ ${label(snapshot.branch)}${R}`;

	return out;
}

interface CacheLedger {
	hit: number | undefined;
	expiresAt: number | undefined;
	misses: number;
	lastMissAt: number | undefined;
	lastMissCause: string | undefined;
}

/**
 * Cache health of the active branch, recomputed from the session so a redraw can never drift
 * from the transcript. A miss is a response whose cached prefix materially shrank without a
 * compaction or branch summary explaining it — CC's own wording for the same events.
 */
function readCacheLedger(ctx: ExtensionContext, nowMs: number): CacheLedger {
	const ttlShort = ctx.model?.promptCache?.short;
	const ttlLong = ctx.model?.promptCache?.long;
	let previous: { cacheRead: number; timestamp?: number } | undefined;
	let rebuiltSincePrevious = false;
	let latest: { usage: { cacheRead: number; cacheWrite: number; input: number; cacheWrite1h?: number }; timestamp?: number } | undefined;
	let misses = 0;
	let lastMissAt: number | undefined;
	let lastMissCause: string | undefined;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			rebuiltSincePrevious = true;
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage;
		const cacheRead = Number.isFinite(usage.cacheRead) ? usage.cacheRead : 0;
		const timestamp = entry.message.timestamp;

		if (previous && !rebuiltSincePrevious && previous.cacheRead > 0
			&& cacheRead < previous.cacheRead * (1 - MATERIAL_SHRINK)) {
			misses += 1;
			lastMissAt = timestamp;
			const ttl = usage.cacheWrite1h ? ttlLong : ttlShort;
			const gap = timestamp !== undefined && previous.timestamp !== undefined ? timestamp - previous.timestamp : undefined;
			lastMissCause = ttl !== undefined && gap !== undefined && gap > ttl * 1000
				? `ttl_expired_${usage.cacheWrite1h ? "1h" : "5m"}`
				: "unknown";
		}
		previous = { cacheRead, timestamp };
		rebuiltSincePrevious = false;
		latest = { usage, timestamp };
	}

	if (!latest) {
		return { hit: undefined, expiresAt: undefined, misses, lastMissAt, lastMissCause };
	}
	const usage = latest.usage;
	const total = usage.input + usage.cacheRead + usage.cacheWrite;
	const hit = Number.isFinite(total) && total > 0 && [usage.cacheRead, usage.cacheWrite].every((v) => Number.isFinite(v) && v >= 0)
		? (usage.cacheRead * 100) / total
		: undefined;
	const ttl = usage.cacheWrite1h ? ttlLong : ttlShort;
	const expiresAt = ttl === undefined || latest.timestamp === undefined
		? undefined
		: Math.floor((latest.timestamp + ttl * 1000) / 1000);
	return { hit, expiresAt, misses, lastMissAt, lastMissCause };
}

export default function (pi: ExtensionAPI) {
	// One live tick per extension instance. `applyFooter` runs again on /custom-footer and on a
	// new session, so the previous timer is cleared before a new one is armed.
	let activeTick: ReturnType<typeof setInterval> | undefined;
	const clearTick = () => {
		if (activeTick !== undefined) {
			clearInterval(activeTick);
			activeTick = undefined;
		}
	};

	const applyFooter = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, _theme, footerData) => {
			const requestRender = () => tui.requestRender();
			const unsubscribe = [
				footerData.onBranchChange(requestRender),
				pi.on("model_select", requestRender),
				pi.on("thinking_level_select", requestRender),
			];
			clearTick();
			activeTick = setInterval(requestRender, REFRESH_MS);

			let disposed = false;
			let cacheSession: string | undefined;
			let cacheLeaf: string | null | undefined;
			let ledger: CacheLedger | undefined;
			let tpmOutput = 0;
			let tpmDuration = 0;

			return {
				invalidate() { cacheSession = undefined; },
				dispose() {
					if (disposed) return;
					disposed = true;
					clearTick();
					for (const off of unsubscribe) off();
				},
				render(width: number): string[] {
					const session = ctx.sessionManager.getSessionId();
					const leaf = ctx.sessionManager.getLeafId();
					if (session !== cacheSession || leaf !== cacheLeaf) {
						const nowMs = Date.now();
						ledger = readCacheLedger(ctx, nowMs);
						cacheSession = session;
						cacheLeaf = leaf;

						// TPM: output tokens over API time, deduplicated by response id like CC's
						// `awk '$1 != l'` over the transcript.
						let output = 0;
						let duration = 0;
						const seen = new Set<string>();
						for (const entry of ctx.sessionManager.getBranch()) {
							if (entry.type !== "message" || entry.message.role !== "assistant") continue;
							const message = entry.message;
							const key = message.responseId ?? message.timestamp?.toString() ?? "";
							if (key && seen.has(key)) continue;
							if (key) seen.add(key);
							if (Number.isFinite(message.usage.output)) output += message.usage.output;
							if (typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs > 0) {
								duration += message.durationMs;
							}
						}
						tpmOutput = output;
						tpmDuration = duration;
					}

					const current = ledger ?? { hit: undefined, expiresAt: undefined, misses: 0, lastMissAt: undefined, lastMissCause: undefined };
					return [truncateToWidth(renderFooter({
						model: ctx.model?.name || ctx.model?.id || "no model",
						effort: pi.getThinkingLevel(),
						contextPercent: ctx.getContextUsage()?.percent ?? null,
						tpmOutputTokens: tpmOutput,
						tpmDurationMs: tpmDuration,
						cache: {
							hit: current.hit,
							expiresAt: current.expiresAt,
							misses: current.misses,
							lastMissAt: current.lastMissAt,
							lastMissCause: current.lastMissCause,
						},
						branch: footerData.getGitBranch(),
						now: Date.now(),
					}), Math.max(0, width))];
				},
			};
		});
	};

	pi.on("session_start", (_event, ctx) => applyFooter(ctx));

	// The timer must not outlive the session it renders for.
	pi.on("session_shutdown", () => clearTick());

	pi.registerCommand("custom-footer", {
		description: "Show the compact model, thinking, context, TPM, cache, and Git footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			applyFooter(ctx);
			ctx.ui.notify("Custom footer restored", "info");
		},
	});

	pi.registerCommand("builtin-footer", {
		description: "Restore the built-in Pi footer",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") return;
			ctx.ui.setFooter(undefined);
			ctx.ui.notify("Built-in footer restored", "info");
		},
	});
}
