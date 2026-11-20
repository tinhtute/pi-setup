import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

/** Constructor shape used to preserve compatibility with older Pi hosts. */
export type CustomEditorConstructor = new (...args: ConstructorParameters<typeof CustomEditor>) => CustomEditor;

/**
 * Paints `text` for the column it will land in. A solid theme token ignores the
 * position; a gradient needs it, and so does anything that has to sweep across
 * the box.
 */
type PromptColor = (text: string, column: number, width: number) => string;

const PROMPT_ICON = "❯";
/** The icon plus its trailing space: with the rail in column 0 the icon lands in
 * column 1, so the slot carries no leading gap of its own. */
const BOXED_PROMPT_WIDTH = 2;
const DASH = "─";

/**
 * Length of the terminal escape sequence starting at `pos`, or 0 when there is
 * none. Only CSI and OSC are handled; everything else falls back to the two-byte
 * form, which is all a repaint has to step over.
 */
function escapeLength(text: string, pos: number): number {
	if (text[pos] !== "\x1b") return 0;
	const kind = text[pos + 1];
	if (kind === "[") {
		let end = pos + 2;
		while (end < text.length && !(text[end] >= "@" && text[end] <= "~")) end += 1;
		return Math.min(text.length, end + 1) - pos;
	}
	if (kind === "]") {
		let end = pos + 2;
		while (end < text.length && text[end] !== "\x07" && !(text[end] === "\x1b" && text[end + 1] === "\\")) end += 1;
		return Math.min(text.length, end + 2) - pos;
	}
	return Math.min(text.length, pos + 2) - pos;
}
/**
 * Build a CustomEditor subclass that reserves room for, and renders, the
 * user-message prompt: a square box around the live input, with `❯` flush against
 * the left rail. The host still owns all editing and app keybindings.
 *
 * `frameColor` is consulted per render, so a `/theme` change moves the frame
 * without recreating the editor.
 */
export function createPromptEditorClass(
	Base: CustomEditorConstructor,
	colorPrompt: PromptColor,
	frameColor?: () => PromptColor | undefined,
): CustomEditorConstructor {
	const basePrototype = Base.prototype as unknown as {
		renderTopBorder?: unknown;
		renderBottomBorder?: unknown;
	};
	const supportsBorderHooks =
		typeof basePrototype.renderTopBorder === "function" && typeof basePrototype.renderBottomBorder === "function";

	class PromptEditor extends Base {
		private userPaddingX = 0;
		private isScrolled = false;
		private bottomBorderLine = "";
		/** The colour the host handed us at construction, used only when no resolver
		 * is installed. Pi reassigns `borderColor` on every theme change, so it is not
		 * treated as an override. */
		private readonly inheritedBorderColor: PromptColor;
		/** Resolved once per render so the probe is not repeated per line. */
		private frame: PromptColor | undefined;

		constructor(...args: ConstructorParameters<CustomEditorConstructor>) {
			const [tui, theme, keybindings, options] = args;
			super(tui, theme, keybindings, { ...(options ?? {}), embedWorkingStatus: true });
			this.inheritedBorderColor = this.borderColor ?? ((text: string) => text);
			this.userPaddingX = super.getPaddingX();
			super.setPaddingX(this.reservedPadding());
		}

		private promptWidth(): number {
			// At zero user padding, reserve one extra column so the icon still has a
			// column to itself beside the rail.
			return BOXED_PROMPT_WIDTH + (this.userPaddingX === 0 ? 1 : 0);
		}

		/** Columns the host must reserve left of the input: user padding plus the prompt slot. */
		private reservedPadding(): number {
			return this.userPaddingX + this.promptWidth();
		}

		override getPaddingX(): number {
			return this.userPaddingX;
		}

		override setPaddingX(padding: number): void {
			this.userPaddingX = Math.max(0, padding);
			super.setPaddingX(this.reservedPadding());
		}

		protected override renderTopBorder(width: number, hiddenLineCount: number): string {
			this.isScrolled = hiddenLineCount > 0;
			const border = super.renderTopBorder(width, hiddenLineCount);
			return this.squareBorder(border, width, "┌", "┐");
		}

		protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
			const border = super.renderBottomBorder(width, hiddenLineCount);
			this.bottomBorderLine = this.squareBorder(border, width, "└", "┘");
			return this.bottomBorderLine;
		}

		private squareBorder(line: string, width: number, left: string, right: string): string {
			if (width < 2 || visibleWidth(line) !== width) return line;
			const middle = this.paintDashes(sliceByColumn(line, 1, width - 2, true), width);
			return `${this.paintFrame(left, 0, width)}${middle}${this.paintFrame(right, width - 1, width)}`;
		}

		/**
		 * Repaint the box-drawing dashes column by column and copy every other byte
		 * verbatim. `borderColor` wraps the whole run, so without this the dashes keep
		 * the host's colour (the thinking-level red at max). Stripping the run instead
		 * would flatten the top border's embedded working status, which is pi-pretty's
		 * own shimmering indicator: the host composes the line as
		 * `borderColor("── ") + status + borderColor(" ──…")`.
		 */
		private paintDashes(text: string, width: number): string {
			let painted = "";
			let column = 1;
			let pos = 0;
			while (pos < text.length) {
				const skip = escapeLength(text, pos);
				if (skip > 0) {
					painted += text.slice(pos, pos + skip);
					pos += skip;
					continue;
				}
				if (text[pos] === DASH) {
					painted += this.paintFrame(DASH, column, width);
					column += 1;
					pos += 1;
					continue;
				}
				let end = pos;
				while (end < text.length && text[end] !== "\x1b" && text[end] !== DASH) end += 1;
				const run = text.slice(pos, end);
				painted += run;
				column += visibleWidth(run);
				pos = end;
			}
			return painted;
		}

		/**
		 * The frame colour: the configured theme token when a resolver is present,
		 * otherwise whatever the host handed us. Pi assigns `borderColor` at startup
		 * for the thinking level — and again on every theme change — so a host value
		 * is the steady state, not an override; the `❯` icon carries the thinking
		 * level instead.
		 */
		private paintFrame(text: string, column: number, width: number): string {
			if (!this.frame) this.frame = frameColor?.() ?? this.borderColor ?? this.inheritedBorderColor;
			return this.frame(text, column, width);
		}

		override render(width: number): string[] {
			this.bottomBorderLine = "";
			this.frame = undefined;
			const lines = super.render(width);
			if (lines.length < 2) return lines;

			if (!this.isScrolled) {
				const firstContentLine = lines[1];
				if (firstContentLine) {
					const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
					const promptPadding = Math.min(this.reservedPadding(), maxPadding);
					// Column 0 is the rail's; the icon takes column 1 and the rest of the
					// reserved slot stays blank so the input keeps its start column.
					if (promptPadding > 1 && firstContentLine.startsWith(" ".repeat(promptPadding))) {
						const prompt = `${colorPrompt(PROMPT_ICON, 1, width)}${" ".repeat(promptPadding - 2)}`;
						lines[1] = `${firstContentLine.slice(0, 1)}${prompt}${firstContentLine.slice(promptPadding)}`;
					}
				}
			}

			if (!supportsBorderHooks || !this.bottomBorderLine) return lines;

			const bottomBorderIndex = lines.lastIndexOf(this.bottomBorderLine);
			const contentEnd = bottomBorderIndex > 0 ? bottomBorderIndex : lines.length - 1;
			for (let i = 1; i < contentEnd; i++) {
				const line = lines[i];
				if (!line || visibleWidth(line) !== width || !line.startsWith(" ") || !line.endsWith(" ")) continue;
				lines[i] = `${this.paintFrame("│", 0, width)}${line.slice(1, -1)}${this.paintFrame("│", width - 1, width)}`;
			}

			return lines;
		}
	}

	return PromptEditor;
}
