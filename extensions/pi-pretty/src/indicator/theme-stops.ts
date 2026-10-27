/**
 * Turn the `stops` setting into the hex list `frames.ts` interpolates.
 *
 * `workingIndicator.stops` has two forms: an explicit `#rrggbb` array (a fixed
 * rainbow, whatever the theme is) and the `"theme"` sentinel, resolved here to a
 * five-step ramp around the active theme's accent. The sentinel exists because a
 * theme token is not a colour a gradient can interpolate: the same setting has to
 * mean a different ramp per theme, and only frame-build time knows the theme.
 *
 * The ramp is pure sRGB arithmetic toward black and white, which is exactly what
 * pi-tui's `mixColors(accent, target, t, "srgb")` computes. Keeping it as plain
 * numbers lets the ASCII banner mirror the same five steps without sharing a
 * module across extension boundaries.
 */

import { THEME_STOPS, type WorkingStops } from "./stops.js";
import type { ThemeColorLike, WorkingThemeLike } from "./types.js";

/** Fractions toward black (negative) and white (positive); the accent sits in the middle. */
export const RAMP_STEPS: readonly number[] = [-0.42, -0.2, 0, 0.22, 0.45];

function hex2(value: number): string {
	const clamped = Math.min(255, Math.max(0, Math.round(value)));
	return clamped.toString(16).padStart(2, "0");
}

/**
 * Five `#rrggbb` stops for one accent: darker → accent → lighter. Returns `[]`
 * when the colour carries no channels, which is what a 256-colour terminal's
 * indexed palette entry looks like.
 */
export function accentRampHexes(color: ThemeColorLike): string[] {
	const { r, g, b } = color;
	if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return [];
	const mix = (channel: number, amount: number): number =>
		amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount;
	return RAMP_STEPS.map((amount) => `#${hex2(mix(r, amount))}${hex2(mix(g, amount))}${hex2(mix(b, amount))}`);
}

/**
 * Resolve the setting for one frame build. `undefined` means "no gradient" and
 * the caller falls back to the three tiers, which are theme tokens already.
 */
export function resolveStops(stops: WorkingStops | undefined, theme?: WorkingThemeLike): string[] | undefined {
	if (!stops) return undefined;
	if (stops !== THEME_STOPS) return [...stops];

	const colors = theme?.colors;
	const ramp = colors?.accent ? accentRampHexes(colors.accent) : [];
	if (ramp.length >= 2) return ramp;
	// No accent channels (indexed palette): the text token is the honest fallback,
	// still the theme's own colour rather than a hardcoded hex.
	const fallback = colors?.text ? accentRampHexes(colors.text) : [];
	return fallback.length >= 2 ? fallback : undefined;
}
