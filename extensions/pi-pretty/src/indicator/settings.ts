/**
 * Configuration for the working row and the hidden-thinking label.
 *
 * Values come from `pi-pretty.json`; environment variables win over the file.
 */

import type { WorkingIndicatorConfig } from "../config.js";
import { envFlag } from "./env.js";
import { normalizeStops } from "./stops.js";
import type { WorkingStops } from "./stops.js";
import type { WorkingIndicatorMode } from "./types.js";

// ─── Settings ────────────────────────────────────────────────────────────────

/** Tier colors as config values: a pi theme color name or a `#rrggbb` hex. */
export interface WorkingIndicatorPalette {
	low: string;
	mid: string;
	high: string;
}

export interface WorkingIndicatorSettings {
	enabled: boolean;
	/** Phrases rotated chapter-by-chapter across the sweep. */
	texts: string[];
	mode: WorkingIndicatorMode;
	palette: WorkingIndicatorPalette;
	/** Multi-stop gradient: an explicit `#rrggbb` list (2+), or `"theme"` for a ramp
	 * derived from the active theme's accent. Absent means tiered colouring. */
	stops?: WorkingStops;
	bold: boolean;
	/** @deprecated Retained for config compatibility; no interrupt hint is rendered. */
	hint: boolean;
	/** Tint mid/high tiers (and dim the spinner) with a per-session accent color. */
	sessionAccent: boolean;
	/** Frame advance interval in ms. Default: WORKING_INTERVAL_MS (33). Higher = fewer
	 * full-tree renders per second while the agent works. */
	intervalMs?: number;
	/** True when the user explicitly configured `mid`/`high` — accent then stays off. */
	tiersCustomized?: boolean;
}

export const WORKING_INDICATOR_DEFAULTS: WorkingIndicatorSettings = {
	enabled: true,
	texts: ["Working…"],
	mode: "shimmer",
	palette: { low: "dim", mid: "muted", high: "accent" },
	bold: true,
	hint: true,
	sessionAccent: true,
	tiersCustomized: false,
};

const MODES: readonly WorkingIndicatorMode[] = ["shimmer", "kitt", "static"];

function isMode(value: unknown): value is WorkingIndicatorMode {
	return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

/** Longest working label we build frames for (the sweep is one frame per code point + padding). */
const MAX_TEXT_CODE_POINTS = 120;

// biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what we sanitize out of user text
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/**
 * Accept a configured label only if it renders safely in the single-line
 * working row: no control characters (including newlines) and bounded length.
 * Returns undefined for anything invalid, falling back to the default.
 */
function sanitizeText(value: unknown): string | undefined {
	const text = typeof value === "string" ? value.trim() : undefined;
	if (!text) return undefined;
	if (CONTROL_CHARS_RE.test(text)) return undefined;
	if ([...text].length > MAX_TEXT_CODE_POINTS) return undefined;
	return text;
}

/** Sanitize a `string | string[]` config value into a valid phrase list. */
function sanitizeTexts(input: unknown): string[] | undefined {
	const list = Array.isArray(input) ? input : [input];
	const out: string[] = [];
	for (const item of list) {
		const text = sanitizeText(item);
		if (text) out.push(text);
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Resolve final settings from `pi-pretty.json`'s flat `workingIndicator` object
 * and env overrides. Precedence: env var > config > default; empty or invalid
 * env values mean unset (matching pi-pretty's config conventions).
 */
export function resolveWorkingIndicatorSettings(
	config: WorkingIndicatorConfig | undefined,
	env: NodeJS.ProcessEnv = process.env,
): WorkingIndicatorSettings {
	const settings: WorkingIndicatorSettings = {
		...WORKING_INDICATOR_DEFAULTS,
		palette: { ...WORKING_INDICATOR_DEFAULTS.palette },
	};
	const envEnabled = envFlag(env.PRETTY_WORKING_INDICATOR);
	if (envEnabled !== undefined) settings.enabled = envEnabled;
	else if (typeof config?.enabled === "boolean") settings.enabled = config.enabled;

	const envMode = isMode(env.PRETTY_WORKING_INDICATOR_MODE) ? env.PRETTY_WORKING_INDICATOR_MODE : undefined;
	settings.mode = envMode ?? (isMode(config?.mode) ? config.mode : settings.mode);

	const envTexts = sanitizeTexts(env.PRETTY_WORKING_INDICATOR_TEXT?.split(",").map((part) => part.trim()));
	settings.texts = envTexts ?? sanitizeTexts(config?.text) ?? settings.texts;

	for (const tier of ["low", "mid", "high"] as const) {
		const value = config?.[tier];
		if (typeof value === "string" && value.trim() !== "") settings.palette[tier] = value;
	}
	if (typeof config?.bold === "boolean") settings.bold = config.bold;
	if (typeof config?.hint === "boolean") settings.hint = config.hint;
	if (typeof config?.sessionAccent === "boolean") settings.sessionAccent = config.sessionAccent;
	const envInterval = Number.parseInt(env.PRETTY_WORKING_INTERVAL_MS ?? "", 10);
	if (Number.isFinite(envInterval) && envInterval >= 33) settings.intervalMs = envInterval;
	else if (typeof config?.intervalMs === "number" && config.intervalMs >= 33) settings.intervalMs = config.intervalMs;
	const stops = normalizeStops(config?.stops);
	if (stops) settings.stops = stops;
	settings.tiersCustomized = typeof config?.mid === "string" || typeof config?.high === "string";
	return settings;
}
