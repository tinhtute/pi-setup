/**
 * Reading `pi-pretty.json`: the schema, the loader, and the small resolvers that
 * derive tool sets and FFF scan settings from it.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isHexColor } from "./ansi.js";

export interface WorkingIndicatorConfig {
	enabled?: boolean;
	/** One phrase or a list of phrases rotated across sweeps. */
	text?: string | string[];
	mode?: "shimmer" | "kitt" | "static";
	/** Tier colors: a pi theme color name or a `#rrggbb` hex. */
	low?: string;
	mid?: string;
	high?: string;
	/** Multi-stop gradient as `#rrggbb` colours (2 or more), or `"theme"` to derive the
	 * ramp from the active theme's accent. When set, the sweep is interpolated per
	 * cell instead of snapping to the three tiers, and `low` stays as the resting
	 * colour. */
	stops?: string[] | "theme";
	bold?: boolean;
	/** @deprecated Retained for config compatibility; the working row no longer renders this hint. */
	hint?: boolean;
	/** Tint the indicator with a stable per-session accent color. */
	sessionAccent?: boolean;
	/** Frame advance interval in ms (>= 33). Higher = cheaper frames while the agent works. */
	intervalMs?: number;
}

export interface ThinkingIndicatorConfig {
	enabled?: boolean;
	/** Label refresh interval in ms (>= 33). Higher = cheaper frames while thinking. */
	intervalMs?: number;
}

export interface FffConfig {
	/** Allow FFF to index the user's home directory when Pi starts there. */
	enableHomeScanning?: boolean;
	/** Allow FFF to index the filesystem root when Pi starts there. */
	enableRootScanning?: boolean;
}

export interface FffScanSettings {
	enableHomeScanning: boolean;
	enableRootScanning: boolean;
}

export interface PrettyConfig {
	background?: {
		tool?: string;
		error?: string;
	};
	/** Left rail bar on user messages: `#rrggbb`, empty/absent disables. Reads as
	 * "highlighted but transparent" on acrylic — one-cell bar, not a full-width bg. */
	userRail?: string;
	theme?: string;
	icons?: string;
	enableTools?: string[];
	disableTools?: string[];
	maxHlChars?: number;
	maxPreviewLines?: number;
	cacheLimit?: number;
	workingIndicator?: WorkingIndicatorConfig;
	thinkingIndicator?: ThinkingIndicatorConfig;
	/** "claudecode" renders collapsed tools as `✓ Name (args)` rows with grouping. */
	toolStyle?: "default" | "claudecode";
	fff?: FffConfig;
}

/** Normalize a comma-separated env value or JSON array into tool names. */
export function normalizeToolList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((v): v is string => typeof v === "string")
		.map((v) => v.trim().toLowerCase())
		.filter(Boolean);
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Read and validate `pi-pretty.json` from the config directory. Invalid
 * fields are silently skipped, matching the historical `background`
 * behavior. The file is re-read on each call; callers that need a stable
 * value (extension activation, theme resolution) cache the result.
 */
export function loadConfig(agentDir = getConfigDir()): PrettyConfig {
	if (!agentDir) return {};
	try {
		const parsed = JSON.parse(readFileSync(join(agentDir, "pi-pretty.json"), "utf8")) as PrettyConfig;
		const config: PrettyConfig = {};
		if (parsed.background) {
			const background: NonNullable<PrettyConfig["background"]> = {};
			if (parsed.background.tool && isHexColor(parsed.background.tool)) {
				background.tool = parsed.background.tool;
			}
			if (parsed.background.error && isHexColor(parsed.background.error)) {
				background.error = parsed.background.error;
			}
			if (background.tool || background.error) config.background = background;
		}
		if (typeof parsed.theme === "string" && parsed.theme.trim() !== "") config.theme = parsed.theme;
		if (parsed.toolStyle === "default" || parsed.toolStyle === "claudecode") config.toolStyle = parsed.toolStyle;
		if (typeof parsed.userRail === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.userRail))
			config.userRail = parsed.userRail;
		if (typeof parsed.icons === "string") config.icons = parsed.icons;
		const enableTools = normalizeToolList(parsed.enableTools);
		const disableTools = normalizeToolList(parsed.disableTools);
		if (enableTools.length) config.enableTools = enableTools;
		if (disableTools.length) config.disableTools = disableTools;
		const maxHlChars = positiveInt(parsed.maxHlChars);
		const maxPreviewLines = positiveInt(parsed.maxPreviewLines);
		const cacheLimit = positiveInt(parsed.cacheLimit);
		if (maxHlChars) config.maxHlChars = maxHlChars;
		if (maxPreviewLines) config.maxPreviewLines = maxPreviewLines;
		if (cacheLimit) config.cacheLimit = cacheLimit;
		const fff = parsed.fff;
		if (fff && typeof fff === "object") {
			const fffConfig: FffConfig = {};
			const src = fff as Record<string, unknown>;
			if (typeof src.enableHomeScanning === "boolean") fffConfig.enableHomeScanning = src.enableHomeScanning;
			if (typeof src.enableRootScanning === "boolean") fffConfig.enableRootScanning = src.enableRootScanning;
			if (Object.keys(fffConfig).length > 0) config.fff = fffConfig;
		}
		const workingIndicator = parsed.workingIndicator;
		if (workingIndicator && typeof workingIndicator === "object") {
			const wi: WorkingIndicatorConfig = {};
			const src = workingIndicator as Record<string, unknown>;
			if (typeof src.enabled === "boolean") wi.enabled = src.enabled;
			if (typeof src.text === "string" && src.text.trim() !== "") wi.text = src.text;
			else if (Array.isArray(src.text)) {
				const list = src.text.filter((item) => typeof item === "string" && item.trim() !== "");
				if (list.length > 0) wi.text = list;
			}
			if (src.mode === "shimmer" || src.mode === "kitt" || src.mode === "static") wi.mode = src.mode;
			for (const tier of ["low", "mid", "high"] as const) {
				const value = src[tier];
				if (typeof value === "string" && value.trim() !== "") wi[tier] = value;
			}
			if (src.stops === "theme") {
				wi.stops = "theme";
			} else if (Array.isArray(src.stops)) {
				const stops = src.stops.filter((item): item is string => typeof item === "string" && item.trim() !== "");
				if (stops.length > 0) wi.stops = stops;
			}
			if (typeof src.bold === "boolean") wi.bold = src.bold;
			if (typeof src.hint === "boolean") wi.hint = src.hint;
			if (typeof src.sessionAccent === "boolean") wi.sessionAccent = src.sessionAccent;
			if (typeof src.intervalMs === "number" && Number.isFinite(src.intervalMs) && src.intervalMs >= 33)
				wi.intervalMs = src.intervalMs;
			if (Object.keys(wi).length > 0) config.workingIndicator = wi;
		}
		const thinkingIndicator = parsed.thinkingIndicator;
		if (thinkingIndicator && typeof thinkingIndicator === "object") {
			const ti: ThinkingIndicatorConfig = {};
			const src = thinkingIndicator as Record<string, unknown>;
			if (typeof src.enabled === "boolean") ti.enabled = src.enabled;
			if (typeof src.intervalMs === "number" && Number.isFinite(src.intervalMs) && src.intervalMs >= 33)
				ti.intervalMs = src.intervalMs;
			if (Object.keys(ti).length > 0) config.thinkingIndicator = ti;
		}
		return config;
	} catch {
		return {};
	}
}

export function getConfigDir(): string {
	return process.env.PRETTY_CONFIG_DIR ?? getDefaultAgentDir();
}

function parseBooleanOverride(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "on") return true;
	if (normalized === "0" || normalized === "false" || normalized === "off") return false;
	return undefined;
}

export function resolveFffScanSettings(
	config: Pick<PrettyConfig, "fff">,
	flags: {
		enableHomeScanning?: boolean | string;
		enableRootScanning?: boolean | string;
	} = {},
	env: NodeJS.ProcessEnv = process.env,
): FffScanSettings {
	const resolve = (
		flagValue: boolean | string | undefined,
		envName: string,
		configValue: boolean | undefined,
	): boolean => parseBooleanOverride(flagValue) ?? parseBooleanOverride(env[envName]) ?? configValue ?? false;

	return {
		enableHomeScanning: resolve(flags.enableHomeScanning, "PRETTY_FFF_HOME_SCAN", config.fff?.enableHomeScanning),
		enableRootScanning: resolve(flags.enableRootScanning, "PRETTY_FFF_ROOT_SCAN", config.fff?.enableRootScanning),
	};
}

/**
 * Merge env tool sets with config-file tool lists: a non-empty env set wins
 * over the config file (12-factor precedence); otherwise config applies.
 */
export function resolveToolSets(
	envDisabled: Set<string>,
	envEnabled: Set<string>,
	config: Pick<PrettyConfig, "disableTools" | "enableTools">,
): { disabledTools: Set<string>; enabledTools: Set<string> } {
	return {
		disabledTools: envDisabled.size > 0 ? envDisabled : new Set(config.disableTools ?? []),
		enabledTools: envEnabled.size > 0 ? envEnabled : new Set(config.enableTools ?? []),
	};
}

/** `HOME` is unset on Windows, where `os.homedir()` resolves `USERPROFILE`. */
export function getDefaultAgentDir(): string {
	return join(process.env.HOME || homedir(), ".pi/agent");
}
