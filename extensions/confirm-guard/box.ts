// The permission dialog for confirm-guard, shaped like Claude Code's.
//
// Measured from a real Claude Code permission prompt (OCR + pixel sampling of a
// screenshot), which corrected two assumptions:
//
//   1. There is no box. A single vertical rail runs down the left edge, and the
//      content sits to its right. A full `╭──╮` frame reads as a modal; the rail
//      reads as "this block is one thing", which is what a tool call is.
//   2. The command is plain bright text, not a tinted code block. Claude Code
//      renders it with SyntaxHighlight at the normal foreground (#d8d8d8), and it
//      is the brightest element in the dialog -- brightness, not background, is
//      what separates the script from the prose around it.
//
// Colours, sampled from that screenshot against a #2a2e35 ground:
//
//   rail + leading ">"        #666666   dim      (theme: "dim")
//   title "Bash command"      #6c9ccc   accent   (theme: "accent")
//   description / meta        #848484   muted    (theme: "muted")
//   command                   #d8d8d8   text     (theme: "text")  <- brightest
//   selected option           #6c9ccc   accent   (theme: "accent")
//   unselected option         #d8d8d8   text
//   hint letters in options   #666666   dim
//
// The emphasis colour is the theme's accent, i.e. the colour the operator reads as the
// theme's primary colour, so `/theme` repaints the title and the selection. `border` used
// to own that register, which on the generated system theme means a blue-cyan title
// (#56a2c7) whatever accent the theme declares. See `emphasis()` for the one exception.
//
// So the visual grammar is: dim rail, accent title, muted meta, bright script,
// accent selection. Four registers, no background fills, no frame.
//
// Nothing here decides anything: confirm-guard/index.ts owns the decision, so the
// guard stays testable without a UI.

import { matchesKey, type Component } from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";

export interface ConfirmBoxOptions {
	/** The pattern that matched, e.g. `git push`. */
	pattern: string;
	/** The command as it will run, already sanitised by the caller. */
	command: string;
	/** Working directory, shown as muted context. Omitted when unknown. */
	cwd?: string;
	/** Why this command is being gated, shown as muted meta. */
	note?: string;
}

/** Rows the user picks between. Enter selects the highlighted one. */
const OPTIONS = [
	{ label: "Yes", hint: "run it this once", accept: true },
	{ label: "No", hint: "do not run it", accept: false },
] as const;

/**
 * Content width: the terminal width minus the rail (1) and the gutter (2). The dialog
 * is not an overlay -- it takes the editor slot -- so it owns every column it is given.
 * It used to stop at 76 columns (Claude Code's own prompt is that narrow on an 80-column
 * terminal), which on a wide terminal left the prompt as a block in the left corner with
 * the rest of each row blank.
 */
function contentWidth(width: number): number {
	return Math.max(1, width - 3);
}

/** Visible width of a styled string: strip SGR, then count code points. */
function visibleWidth(text: string): number {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR on purpose
	return [...text.replace(/\x1b\[[0-9;]*m/g, "")].length;
}

/**
 * WCAG relative luminance of a token, or `NaN` when the token is not RGB -- an indexed
 * 256-colour accent carries `kind` but no channels, and there is nothing to compare
 * then. Only used to decide whether an accent can carry emphasis over the rail.
 */
function luminance(color: unknown): number {
	const { r, g, b } = (color ?? {}) as { r?: number; g?: number; b?: number };
	if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return Number.NaN;
	const channel = (value: number): number => {
		const n = value / 255;
		return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Cut a styled line to `limit` visible columns, marking the cut with an ellipsis. */
function truncate(text: string, limit: number): string {
	if (visibleWidth(text) <= limit) return text;
	let visible = 0;
	let out = "";
	for (let i = 0; i < text.length; ) {
		const rest = text.slice(i);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR on purpose
		const sgr = rest.match(/^\x1b\[[0-9;]*m/);
		if (sgr) {
			out += sgr[0];
			i += sgr[0].length;
			continue;
		}
		const cp = rest.codePointAt(0);
		if (cp === undefined) break;
		const char = String.fromCodePoint(cp);
		if (visible + 1 > limit - 1) break;
		out += char;
		visible += 1;
		i += char.length;
	}
	return `${out}…\x1b[0m`;
}

export class ConfirmBox implements Component {
	private selected = 0;
	private theme: Theme;
	private options: ConfirmBoxOptions;
	private done: (accepted: boolean) => void;

	constructor(theme: Theme, options: ConfirmBoxOptions, done: (accepted: boolean) => void) {
		this.theme = theme;
		this.options = options;
		this.done = done;
	}

	/**
	 * One row: the rail, a two-space gutter, then the content. Every row carries the
	 * rail so the block reads as a single continuous unit, the way Claude Code's
	 * prompt does.
	 */
	private row(content: string, width: number): string {
		const { theme } = this;
		// contentWidth is the *content* budget; the rail and the gutter occupy 3 columns
		// outside it, so the rendered line is exactly `width`.
		const limit = contentWidth(width);
		const body = truncate(content, limit);
		const gap = Math.max(0, limit - visibleWidth(body));
		return `${theme.fg("dim", "│")}  ${body}${" ".repeat(gap)}`;
	}

	/** A blank row still carries the rail, so the line never breaks. */
	private blank(width: number): string {
		return this.row("", width);
	}

	/**
	 * The emphasis register: the theme's accent, which is the colour the operator reads as
	 * the theme's primary colour. One exception keeps it legible -- a theme whose accent is
	 * darker than its own dim (the bundled `cyan` theme ships #4d788e against #7e888e)
	 * would make the title and the selection look disabled, so `border`, the bright frame
	 * colour in exactly those themes, takes over. An indexed accent has no channels to
	 * compare and is simply used.
	 */
	private emphasis(text: string): string {
		const { theme } = this;
		const accent = theme.colors?.accent;
		const dim = theme.colors?.dim;
		const accentLuminance = luminance(accent);
		const dimLuminance = luminance(dim);
		if (Number.isNaN(accentLuminance) || Number.isNaN(dimLuminance) || accentLuminance >= dimLuminance) {
			return theme.fg("accent", text);
		}
		return theme.fg("border", text);
	}

	render(width: number): string[] {
		const { theme } = this;
		const rows: string[] = [];
		const push = (content = "") => rows.push(this.row(content, width));

		// Title: the emphasis token, like Claude Code's "Bash command".
		push(this.emphasis(theme.bold("Bash command")));
		push();

		// Why it appeared, muted — the same weight as Claude Code's description.
		if (this.options.note) {
			push(theme.fg("muted", this.options.note));
			push();
		}

		// The script: plain and bright. This is the element being judged, so it is the
		// brightest body text in the dialog. Each physical line gets its own row.
		for (const line of this.options.command.split("\n")) {
			push(theme.fg("text", line));
		}

		if (this.options.cwd) {
			push();
			push(theme.fg("muted", `cwd: ${this.options.cwd}`));
		}

		push();
		// The question, one step above the script in weight: same hue family, bold, so it
		// reads as the ask rather than as more output. Claude Code keeps it the same
		// colour as the command and relies on position; bold adds the emphasis without
		// inventing a colour the theme does not have.
		push(theme.fg("text", theme.bold("Do you want to proceed?")));
		push();

		// Options: `>` and the focused label in the accent; the number and the hint are
		// dim. Selected and focused are the same row here -- there is no separate cursor.
		const limit = contentWidth(width);
		OPTIONS.forEach((option, index) => {
			const focused = index === this.selected;
			const pointer = focused ? this.emphasis(">") : " ";
			const number = theme.fg("dim", `${index + 1}.`);
			const label = focused ? this.emphasis(option.label) : theme.fg("text", option.label);
			const line = `${pointer} ${number} ${label}`;
			const hint = theme.fg("dim", option.hint);
			const gap = Math.max(1, limit - visibleWidth(line) - visibleWidth(hint));
			push(line + " ".repeat(gap) + hint);
		});

		push();
		push(theme.fg("dim", "enter to confirm · esc to cancel · ↑↓ to choose"));

		return rows;
	}

	invalidate(): void {
		// Nothing cached: every render reads the current theme and selection.
	}

	handleInput(data: string): void {
		if (matchesKey(data, "up")) {
			this.selected = (this.selected - 1 + OPTIONS.length) % OPTIONS.length;
			return;
		}
		if (matchesKey(data, "down")) {
			this.selected = (this.selected + 1) % OPTIONS.length;
			return;
		}
		if (matchesKey(data, "1")) {
			this.done(OPTIONS[0].accept);
			return;
		}
		if (matchesKey(data, "2")) {
			this.done(OPTIONS[1].accept);
			return;
		}
		if (matchesKey(data, "enter")) {
			this.done(OPTIONS[this.selected].accept);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(false);
		}
	}
}

/**
 * Ask for confirmation using the Claude-Code-shaped dialog.
 *
 * Falls back to `ctx.ui.confirm` when `custom` is unavailable, so a host without the
 * custom-component API still gets a working guard rather than an unguarded command.
 */
export async function confirmWithBox(
	ctx: {
		ui: {
			custom?: <T>(
				factory: (
					tui: unknown,
					theme: Theme,
					keybindings: KeybindingsManager,
					done: (result: T) => void,
				) => Component,
				options?: { overlay?: boolean },
			) => Promise<T>;
			confirm: (title: string, message: string) => Promise<boolean>;
		};
	},
	options: ConfirmBoxOptions,
): Promise<boolean> {
	if (typeof ctx.ui.custom !== "function") {
		return ctx.ui.confirm(`Run ${options.pattern}?`, options.command);
	}

	const accepted = await ctx.ui.custom<boolean>(
		(_tui, theme, _keybindings, done) => new ConfirmBox(theme, options, done),
		// Not an overlay: an overlay floats in the middle of the screen, detached from
		// the conversation and covering the prompt. Without it the dialog is pushed into
		// the editor slot, which is exactly where Claude Code puts its prompt -- directly
		// under the last message and directly above the input line.
		{ overlay: false },
	);
	// A dismissed overlay resolves to undefined: treat it as a refusal.
	return accepted === true;
}
