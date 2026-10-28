/**
 * ANSI palette and background resolution.
 *
 * Every mutable binding lives here, because ESM forbids assigning to an imported
 * binding: the only module that may write `RST` or `BG_BASE` is the one that
 * declares it. `resolveBaseBackground()` and `applyConfig()` therefore live here
 * too rather than in an orchestrator that would have to write across module lines.
 */

import { getConfigDir, loadConfig, type PrettyConfig } from "./config-file.js";

/** Left indent for rendered tool result lines (was two spaces; one matches tighter TUI layout). */
export const TOOL_RESULT_INDENT = " ";

export let RST = "\x1b[0m";

export const FG_LNUM = "\x1b[38;2;100;100;100m";
export const FG_DIM = "\x1b[38;2;80;80;80m";
export const FG_RULE = "\x1b[38;2;50;50;50m";
export const FG_BLUE = "\x1b[38;2;100;140;220m";
export const FG_MUTED = "\x1b[38;2;139;148;158m";

const BG_DEFAULT = "\x1b[49m";

export let BG_BASE = BG_DEFAULT;
export let BG_ERROR = BG_DEFAULT;

type BgThemeLike = {
	getBgAnsi?: (key: string) => string;
	bg?: (key: string, text: string) => string;
};

const ESC_RE = "\u001b";

function parseAnsiRgb(ansi: string): { r: number; g: number; b: number } | null {
	const m = ansi.match(new RegExp(`${ESC_RE}\\[(?:38|48);2;(\\d+);(\\d+);(\\d+)m`));
	return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function getThemeBgAnsi(theme: BgThemeLike, key: string): string | null {
	try {
		const direct = theme.getBgAnsi?.(key);
		if (direct && parseAnsiRgb(direct)) return direct;

		const marker = "\0";
		const styled = theme.bg?.(key, marker);
		const markerIndex = styled?.indexOf(marker) ?? -1;
		const ansi = markerIndex > 0 ? styled?.slice(0, markerIndex) : null;
		return ansi && parseAnsiRgb(ansi) ? ansi : null;
	} catch {
		return null;
	}
}

/** True for `#rrggbb` / `rrggbb`. Exported so the JSON loader can validate a
 * background colour without importing the ANSI converter. */
export function isHexColor(hex: string): boolean {
	return /^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.test(hex);
}

function hexToAnsiBg(hex: string): string | null {
	const m = hex.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
	if (!m) return null;
	const r = Number.parseInt(m[1], 16);
	const g = Number.parseInt(m[2], 16);
	const b = Number.parseInt(m[3], 16);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function applyPrettyConfigBg(agentDir?: string): boolean {
	const config = loadConfig(agentDir);
	if (!config.background?.tool) return false;
	const toolBg = hexToAnsiBg(config.background.tool);
	if (!toolBg) return false;
	BG_BASE = toolBg;
	BG_ERROR = config.background.error ? (hexToAnsiBg(config.background.error) ?? toolBg) : toolBg;
	RST = "\x1b[0m";
	return true;
}

export function resolveBaseBackground(theme: BgThemeLike | null | undefined): void {
	const configDir = getConfigDir();
	if (applyPrettyConfigBg(configDir)) return;
	if (!theme?.getBgAnsi && !theme?.bg) return;
	BG_BASE =
		getThemeBgAnsi(theme, "toolSuccessBg") ??
		getThemeBgAnsi(theme, "toolBg") ??
		getThemeBgAnsi(theme, "background") ??
		BG_DEFAULT;
	BG_ERROR = getThemeBgAnsi(theme, "toolErrorBg") ?? BG_BASE;
	RST = "\x1b[0m";
}

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
	const v = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

export let MAX_HL_CHARS = envInt("PRETTY_MAX_HL_CHARS", 80_000);
export let MAX_PREVIEW_LINES = envInt("PRETTY_MAX_PREVIEW_LINES", 80);
export let CACHE_LIMIT = envInt("PRETTY_CACHE_LIMIT", 128);

/**
 * Apply `pi-pretty.json` values to the env-backed module bindings. An env
 * var wins over the config file whenever it is set to a non-empty value;
 * empty strings are treated as unset. Call once at extension activation,
 * before any render reads the bindings.
 */
export function applyConfig(config: PrettyConfig): void {
	if (!process.env.PRETTY_MAX_HL_CHARS && config.maxHlChars) MAX_HL_CHARS = config.maxHlChars;
	if (!process.env.PRETTY_MAX_PREVIEW_LINES && config.maxPreviewLines) MAX_PREVIEW_LINES = config.maxPreviewLines;
	if (!process.env.PRETTY_CACHE_LIMIT && config.cacheLimit) CACHE_LIMIT = config.cacheLimit;
}

// ---------------------------------------------------------------------------
// Agent directory helpers
// ---------------------------------------------------------------------------
