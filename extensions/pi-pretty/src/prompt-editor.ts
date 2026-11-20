import type { CustomEditor } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

/** Constructor shape used to preserve compatibility with older Pi hosts. */
export type CustomEditorConstructor = new (...args: ConstructorParameters<typeof CustomEditor>) => CustomEditor;

type PromptColor = (text: string) => string;

const PROMPT_ICON = "❯";
/** The icon plus its trailing space: with the rail in column 0 the icon lands in
 * column 1, so the slot carries no leading gap of its own. */
const BOXED_PROMPT_WIDTH = 2;
/** Compared against the inherited colour to tell a host override (thinking level,
 * bash mode) from the editor's own default. */
const BORDER_PROBE = "│";

/**
 * Build a CustomEditor subclass that reserves room for, and renders, the
 * user-message prompt: a square box around the live input, with `❯` flush against
 * the left rail. The host still owns all editing and app keybindings.
 *
 * `frameColor` is consulted per render, so a `/theme` change moves the frame
 * without recreating the editor; when the host has painted its own border colour
 * (thinking level, bash mode) that colour wins.
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
		/** The colour the host handed us at construction; anything else on
		 * `borderColor` later is a host override. */
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
			return `${this.paintFrame(left)}${sliceByColumn(line, 1, width - 2, true)}${this.paintFrame(right)}`;
		}

		/**
		 * The frame colour, in precedence order: a border colour the host assigned
		 * after construction (thinking level, bash mode), then the configured theme
		 * token, then whatever the host handed us.
		 */
		private paintFrame(text: string): string {
			if (!this.frame) {
				const host = this.borderColor ?? this.inheritedBorderColor;
				const overridden =
					host !== this.inheritedBorderColor && host(BORDER_PROBE) !== this.inheritedBorderColor(BORDER_PROBE);
				this.frame = overridden ? host : (frameColor?.() ?? host);
			}
			return this.frame(text);
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
						const prompt = `${colorPrompt(PROMPT_ICON)}${" ".repeat(promptPadding - 2)}`;
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
				lines[i] = `${this.paintFrame("│")}${line.slice(1, -1)}${this.paintFrame("│")}`;
			}

			return lines;
		}
	}

	return PromptEditor;
}
