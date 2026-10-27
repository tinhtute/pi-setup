/**
 * Shapes shared by more than one indicator module. Kept apart from the
 * resolvers so frames/palette can depend on the vocabulary without pulling in
 * config loading.
 */

export type WorkingIndicatorMode = "shimmer" | "kitt" | "static";

/** Resolved ANSI open sequences per shimmer tier. */
export interface ResolvedPalette {
	low: string;
	mid: string;
	high: string;
}

/** Narrow slice of pi's Theme the palette resolver reads. */
export interface ThemeAnsiSource {
	/** Narrowed tier names; pi's Theme (ThemeColor) satisfies this structurally. */
	getFgAnsi?: (name: "dim" | "muted" | "accent" | "thinkingText") => string;
	/** Concrete per-token colours (`Theme.colors`); a gradient needs channels, not ANSI. */
	colors?: Readonly<Record<string, ThemeColorLike | undefined>>;
}

/**
 * Structural slice of a pi-tui colour: `r`/`g`/`b` for a truecolor theme, only
 * `index` when the terminal cannot do truecolor. Nothing here imports pi-tui, so
 * the resolvers stay usable from modules that must not depend on it.
 */
export interface ThemeColorLike {
	readonly kind?: string;
	readonly r?: number;
	readonly g?: number;
	readonly b?: number;
	readonly index?: number;
}

/** Structural slice of pi's Theme needed for the palette and thinking label. */
export interface WorkingThemeLike {
	/** Retained for compatibility with older theme adapters. */
	fg?: (name: "dim", text: string) => string;
	getFgAnsi?: (name: "dim" | "muted" | "accent" | "thinkingText") => string;
	/** `Theme.colors`: what `stops: "theme"` derives its ramp from. */
	colors?: Readonly<Record<string, ThemeColorLike | undefined>>;
}

/** Slice of the pi-tui TUI instance the widget needs. */
export interface WidgetTuiLike {
	requestRender(): void;
}

/** Slice of the extension UI the thinking label needs. */
export interface ThinkingUiLike {
	theme?: WorkingThemeLike;
	setHiddenThinkingLabel(label?: string): void;
}
