/**
 * Animated hidden-thinking label and the per-row label fan-out.
 *
 * Pi renders the label as static italic `thinkingText`; this animates it with
 * the same frame builder as the working row, and patches the host's message
 * component so each row keeps its own accumulated duration.
 */

import { hexToAnsiFg, sessionAccentHex } from "../session-color.js";
import { buildWorkingFrames } from "./frames.js";
import { colorToAnsi, FG_THINKING_FALLBACK, resolvePaletteAnsi } from "./palette.js";
import type { WorkingIndicatorSettings } from "./settings.js";
import { resolveStops } from "./theme-stops.js";
import type { ThinkingIndicatorSettings } from "./thinking-settings.js";
import type { ResolvedPalette, ThinkingUiLike } from "./types.js";

// ─── Per-row hidden-thinking labels ──────────────────────────────────────────

/** Controller for the host-component label interception. */
export interface PerRowThinkingLabels {
	/** Mark the message currently streaming a thinking block (its row animates). */
	setActive(timestamp: number): void;
	/** Freeze a message's completed thinking duration in ms (its row shows
	 * `Thought for X` derived from this). */
	complete(timestamp: number, durationMs: number): void;
	/** Drop the active mark (run ended); completed rows keep their durations. */
	clearActive(): void;
	/** Restore the original prototype setter. */
	uninstall(): void;
}

const PER_ROW_PATCH = Symbol.for("pi-pretty.per-row-thinking-labels");

interface RowInternals {
	lastMessage?: { timestamp?: unknown };
}

/**
 * Intercept the host's per-row label fan-out method
 * (`AssistantMessageComponent.prototype.setHiddenThinkingLabel`): each row
 * substitutes the incoming global label with its own — the streaming row
 * animates, completed rows stay frozen at their own `Thought for X`, unknown
 * rows fall back to pi's default. Any per-call failure passes the incoming
 * label through unchanged, so a host internals change degrades to pi-pretty's
 * global-label behavior instead of breaking. Durations live per session.
 */
export function installPerRowThinkingLabels(componentClass: unknown): PerRowThinkingLabels | undefined {
	const proto = (componentClass as { prototype?: { setHiddenThinkingLabel?: unknown } } | undefined)?.prototype;
	const original = proto?.setHiddenThinkingLabel;
	if (typeof componentClass !== "function" || !proto || typeof original !== "function") return undefined;
	const existing = (original as { [PER_ROW_PATCH]?: PerRowThinkingLabels })[PER_ROW_PATCH];
	// Reuse the installed patch but start from clean state: a session_start
	// without an intervening shutdown (defensive) must not resurrect stale rows.
	if (existing) {
		existing.clearActive();
		return existing;
	}

	const state: { activeTs?: number; completed: Map<number, number> } = { completed: new Map() };
	const patched = function (this: unknown, label: string | undefined): void {
		const own = ownLabel(this, label);
		(original as (this: unknown, label: string | undefined) => void).call(this, own);
	};
	const ownLabel = (component: unknown, incoming: string | undefined): string | undefined => {
		try {
			const ts = (component as RowInternals | undefined)?.lastMessage?.timestamp;
			if (typeof ts !== "number") return incoming;
			if (ts === state.activeTs) return incoming;
			const ms = state.completed.get(ts);
			return ms === undefined ? thinkingLabel() : thoughtLabel(ms);
		} catch {
			return incoming;
		}
	};
	const controller: PerRowThinkingLabels = {
		setActive(timestamp: number): void {
			state.activeTs = timestamp;
		},
		complete(timestamp: number, durationMs: number): void {
			state.completed.set(timestamp, durationMs);
		},
		clearActive(): void {
			state.activeTs = undefined;
		},
		uninstall(): void {
			if (proto.setHiddenThinkingLabel === patched) {
				proto.setHiddenThinkingLabel = original as { setHiddenThinkingLabel?: unknown }["setHiddenThinkingLabel"];
			}
			state.completed.clear();
			state.activeTs = undefined;
		},
	};
	(patched as { [PER_ROW_PATCH]?: PerRowThinkingLabels })[PER_ROW_PATCH] = controller;
	proto.setHiddenThinkingLabel = patched as NonNullable<{ setHiddenThinkingLabel?: unknown }["setHiddenThinkingLabel"]>;
	return controller;
}

export interface ThinkingLabelAnimator {
	/** Apply the next shimmer frame, rebuilding frames when the label changes. */
	tick(label?: string): void;
	/** Apply a non-animated label (the host supplies its normal thinking style). */
	show(label: string): void;
	/** Restore pi's default static label. */
	restore(): void;
	/** Current pre-rendered label frames (exposed for diagnostics). */
	readonly frames: readonly string[];
}

export interface ThinkingTimer {
	/** Render the active label with the current elapsed duration. */
	tick(): void;
	/** Freeze the elapsed duration; returns the total in milliseconds, or
	 * undefined when the timer was already terminal. */
	complete(): number | undefined;
	/** Restore pi's default label and make the timer terminal. */
	restore(): void;
}

const thinkingLabel = (): string => " Thinking...";
const padThinkingLabel = (label: string): string => (label.startsWith(" ") ? label : ` ${label}`);
/** Settled label for a finished thinking run. */
const thoughtLabel = (ms: number): string => ` Thought for ${formatThinkingDuration(ms)}`;

/** Format sub-second elapsed time as milliseconds, then use compact whole seconds. */
export function formatThinkingDuration(elapsedMs: number): string {
	const wholeMs = Math.max(0, Math.floor(elapsedMs));
	if (wholeMs < 1000) return `${wholeMs}ms`;
	const totalSeconds = Math.floor(wholeMs / 1000);
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);
	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
	return `${seconds}s`;
}

/**
 * Couple elapsed-time wording to the label animator through an injected clock.
 * The timer starts on the first thinking delta, freezes once, and is terminal
 * after completion or restore. `startElapsedMs` resumes a later run in the
 * same message from its accumulated thinking time (per-message semantics:
 * the host renders one label line per thinking run, all sharing the message
 * label, so a fresh-zero restart would visibly rewind earlier lines).
 */
export function createThinkingTimer(
	animator: ThinkingLabelAnimator,
	now: () => number = Date.now,
	startElapsedMs = 0,
): ThinkingTimer {
	const startedAt = now() - startElapsedMs;
	let terminal = false;
	const elapsed = (): number => now() - startedAt;
	const duration = (): string => formatThinkingDuration(elapsed());
	return {
		tick(): void {
			if (terminal) return;
			animator.tick(`${thinkingLabel()} ${duration()}`);
		},
		complete(): number | undefined {
			if (terminal) return undefined;
			terminal = true;
			const ms = elapsed();
			animator.show(thoughtLabel(ms));
			return ms;
		},
		restore(): void {
			terminal = true;
			animator.restore();
		},
	};
}

/**
 * True while a streaming assistant message is currently emitting a thinking
 * block (its last content block). Used to gate label ticks to the thinking
 * phase — once text or tool calls stream, the label is frozen back to pi's
 * default instead of rebuilding the transcript for a row nobody watches.
 */
export function thinkingBlockActive(message: unknown): boolean {
	const content = (message as { content?: Array<{ type?: string }> } | undefined)?.content;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content[content.length - 1]?.type === "thinking";
}

/**
 * Animate pi's hidden-thinking label ("Thinking...") with the same shimmer as
 * the working row. Pi renders the label as static italic `thinkingText` text;
 * the only extension lever is `setHiddenThinkingLabel(label)`, which rebuilds
 * chat children, so index.ts drives it at 30fps only while the streaming
 * message's last block is thinking. The elapsed label is rebuilt when its
 * displayed duration changes; the shimmer frame still advances every tick.
 *
 * Tiers: low = theme `thinkingText` (pi's own label look), mid/high = session
 * accent when enabled; every frame is italic like pi's label; no spinner.
 */
export function createThinkingLabelAnimator(
	ui: ThinkingUiLike,
	workSettings: WorkingIndicatorSettings,
	sessionName?: string,
	thinking?: ThinkingIndicatorSettings,
): ThinkingLabelAnimator {
	const noop: ThinkingLabelAnimator = {
		tick() {},
		show() {},
		restore() {},
		frames: [],
	};
	if (thinking && !thinking.enabled) return noop;
	if (typeof ui.setHiddenThinkingLabel !== "function") return noop;

	const ansiResolved = resolvePaletteAnsi(workSettings.palette, ui.theme);
	let ansi: ResolvedPalette = {
		...ansiResolved,
		low: colorToAnsi("thinkingText", ui.theme, FG_THINKING_FALLBACK),
	};
	if (workSettings.sessionAccent && sessionName && !workSettings.tiersCustomized && !workSettings.stops) {
		const accent = hexToAnsiFg(sessionAccentHex(sessionName));
		if (accent) ansi = { ...ansi, mid: accent, high: accent };
	}
	const buildLabelFrames = (label: string): string[] => {
		const padded = padThinkingLabel(label);
		const text = padded.trimStart();
		const leftPadding = padded.slice(0, padded.length - text.length);
		return buildWorkingFrames([text], {
			mode: workSettings.mode,
			ansi,
			stops: resolveStops(workSettings.stops, ui.theme),
			bold: workSettings.bold,
			spinner: false,
			italic: true,
		}).frames.map((frame) => `${leftPadding}${frame}`);
	};

	let currentLabel = thinkingLabel();
	let frames = buildLabelFrames(currentLabel);

	let index = 0;
	let appliedLabel: string | undefined;
	return {
		get frames(): readonly string[] {
			return frames;
		},
		tick(label = thinkingLabel()): void {
			const paddedLabel = padThinkingLabel(label);
			if (paddedLabel !== currentLabel) {
				frames = buildLabelFrames(paddedLabel);
				currentLabel = paddedLabel;
			}
			// A static frame changes only when its elapsed-time label changes.
			if (appliedLabel === currentLabel && frames.length === 1) return;
			ui.setHiddenThinkingLabel(frames[index % frames.length]);
			index++;
			appliedLabel = currentLabel;
		},
		show(label: string): void {
			ui.setHiddenThinkingLabel(padThinkingLabel(label));
		},
		restore(): void {
			// undefined → pi falls back to its default static label.
			ui.setHiddenThinkingLabel(undefined);
		},
	};
}
