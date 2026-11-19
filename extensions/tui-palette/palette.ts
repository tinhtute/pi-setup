// One palette for the TUI layer.
//
// Every surface that paints a *status* asks this module which theme token to use, so no
// surface carries its own ANSI table. Two surfaces are deliberately outside it: the banner
// keeps a fixed rainbow (a signature, not a status — pinned by `tests/test-palette-theme.mjs`),
// and Shiki code blocks follow `config/pi-pretty.json`'s `theme` instead.
//
// Slots, and what each one is for:
//
//   accent    identity and emphasis -- the model, the branch, a metering mark
//   border    the contrast fallback for emphasis on themes whose accent is darker than dim
//   text      the brightest body register
//   muted     secondary labels
//   dim       quiet metadata, and the "nothing is wrong" threshold colour
//   success   a healthy threshold
//   warning   an approaching threshold
//   error     a crossed threshold
//
// `/theme` repaints every one of them, because they are pi's own colour names rather than
// literals. The footer used to hardcode nine 256-colour ANSI escapes for byte parity with
// `~/.claude/statusline.sh`; the owner replaced that rule on 2026-11-19 with "one accent
// from the Pi theme" (see `.monows/plans/active/tui-palette-contract.md`, R3).

import type { Theme } from "@earendil-works/pi-coding-agent";

/** The slots this layer paints with; each names a pi theme colour. */
export type PaletteSlot =
	| "accent"
	| "border"
	| "text"
	| "muted"
	| "dim"
	| "success"
	| "warning"
	| "error";

/**
 * What painting needs from a theme: `fg` to draw, and the two raw colours the emphasis
 * rule compares. `undefined` is allowed so a renderer still produces a plain line when no
 * TUI theme is available (print/JSON modes).
 */
export type PaletteTheme =
	| {
			fg(slot: PaletteSlot, text: string): string;
			colors?: { accent?: unknown; dim?: unknown };
	  }
	| undefined;

/** Paint `text` with `slot`, or return it untouched when there is no theme. */
export function paint(theme: PaletteTheme, slot: PaletteSlot, text: string): string {
	return theme ? theme.fg(slot, text) : text;
}

/**
 * A threshold reading, in the three registers a status line needs. `quiet` is the resting
 * colour rather than a fourth hue: "nothing is wrong" should not compete with the numbers.
 */
export type Level = "quiet" | "warn" | "high";

export function levelToken(level: Level): PaletteSlot {
	switch (level) {
		case "quiet":
			return "dim";
		case "warn":
			return "warning";
		default:
			return "error";
	}
}

/**
 * WCAG relative luminance of a token, or `NaN` when the token is not RGB — an indexed
 * 256-colour accent carries `kind` but no channels, and there is nothing to compare then.
 */
export function luminance(color: unknown): number {
	const { r, g, b } = (color ?? {}) as { r?: number; g?: number; b?: number };
	if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return Number.NaN;
	const channel = (value: number): number => {
		const n = value / 255;
		return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The emphasis register: the theme's accent, unless that accent is darker than the theme's
 * own dim, in which case a title or a selection painted with it would read as disabled.
 * `border` — the bright frame colour in exactly those themes — takes over then. An indexed
 * accent has no channels and is simply used.
 */
export function emphasisToken(theme: PaletteTheme): PaletteSlot {
	const accent = luminance(theme?.colors?.accent);
	const dim = luminance(theme?.colors?.dim);
	if (Number.isNaN(accent) || Number.isNaN(dim) || accent >= dim) return "accent";
	return "border";
}

/** Emphasis painted, for callers that only want the string. */
export function emphasis(theme: PaletteTheme, text: string): string {
	return paint(theme, emphasisToken(theme), text);
}
