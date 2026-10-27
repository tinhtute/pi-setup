/**
 * Continuous multi-stop gradient for the shimmer band.
 *
 * Upstream's sweep quantises each cell into one of three tiers (low/mid/high),
 * so a wide band reads as three flat blocks of colour that jump at the tier
 * boundaries. This resolves the same intensity curve into a real gradient: N
 * stops interpolated per cell, so neighbours differ by a few RGB units instead of
 * a whole tier.
 *
 * The stop list is configuration, not a built-in: `workingIndicator.stops` in
 * `pi-pretty.json` carries it, and its absence means "keep the three tiers". A
 * default baked in here would silently override `sessionAccent` for every config
 * that predates the key.
 *
 * Colours go through pi-tui's own colour maths (parseColor/mixColors/colorToRgb),
 * which is what the custom banner uses, so the banner and these labels share one
 * colour pipeline.
 */

import { type Color, colorToRgb, mixColors, parseColor } from "@earendil-works/pi-tui";

/** `#rrggbb` only: a gradient stop must be a concrete colour, not a theme token. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Sentinel for "derive the ramp from the active theme's accent". A token name
 * cannot be interpolated — the same setting has to mean a different ramp per
 * theme — so it is resolved at frame-build time by `theme-stops.ts`.
 */
export const THEME_STOPS = "theme";

/** Configured stops: an explicit hex list, or the theme sentinel. */
export type WorkingStops = readonly string[] | typeof THEME_STOPS;

/**
 * Keep only valid hex stops; return undefined when fewer than two remain, because
 * a single stop is not a gradient (the caller then falls back to the flat tiers).
 * The `"theme"` sentinel passes through untouched.
 */
export function normalizeStops(value: unknown): WorkingStops | undefined {
	if (value === THEME_STOPS) return THEME_STOPS;
	if (!Array.isArray(value)) return undefined;
	const stops = value.filter((v): v is string => typeof v === "string" && HEX_RE.test(v.trim())).map((v) => v.trim());
	return stops.length >= 2 ? stops : undefined;
}

/** Cache parsed stops: frames are rebuilt per label, not per cell. */
const parsedCache = new Map<string, Color[]>();

function parseStops(stops: readonly string[]): Color[] | undefined {
	const key = stops.join(",");
	const cached = parsedCache.get(key);
	if (cached) return cached;
	try {
		const parsed = stops.map((s) => parseColor(s));
		if (parsedCache.size > 16) parsedCache.clear();
		parsedCache.set(key, parsed);
		return parsed;
	} catch {
		return undefined;
	}
}

/**
 * Colour for a 0..1 position along the stop list, as an ANSI foreground sequence.
 * Positions between stops are interpolated; sRGB matches the banner.
 */
export function gradientAnsiAt(stops: readonly string[], t: number): string {
	const colors = parseStops(stops);
	if (!colors || colors.length < 2) return "";

	const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	const position = clamped * (colors.length - 1);
	const index = Math.min(Math.floor(position), colors.length - 2);
	const first = colors[index];
	const second = colors[index + 1];
	if (!first || !second) return "";

	const mixed = mixColors(first, second, position - index, "srgb");
	const { r, g, b } = colorToRgb(mixed);
	// colorToRgb returns fractional channels after mixing; SGR only accepts integers,
	// and a float makes the terminal drop the whole sequence.
	return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
}

/** Exposed for tests: drop the parsed-colour cache. */
export function resetGradientStopsForTests(): void {
	parsedCache.clear();
}
