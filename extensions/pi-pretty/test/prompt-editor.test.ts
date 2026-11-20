import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import piPrettyExtension from "../src/index.js";
import { type CustomEditorConstructor, createPromptEditorClass } from "../src/prompt-editor.js";

class FakeEditor {
	private padding = 1;
	protected borderColor = (text: string): string => text;

	constructor(..._args: unknown[]) {}

	protected renderTopBorder(width: number, _hiddenLineCount: number): string {
		return "─".repeat(width);
	}

	protected renderBottomBorder(width: number, _hiddenLineCount: number): string {
		return "─".repeat(width);
	}

	getPaddingX(): number {
		return this.padding;
	}

	setPaddingX(padding: number): void {
		this.padding = padding;
	}

	render(width: number): string[] {
		return [this.renderTopBorder(width, 0), `${" ".repeat(this.padding)}draft`, this.renderBottomBorder(width, 0)];
	}
}

const fakeEditorClass = FakeEditor as unknown as CustomEditorConstructor;

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("prompt editor", () => {
	it("renders the prompt icon while preserving editor padding", () => {
		const PromptEditor = createPromptEditorClass(
			fakeEditorClass,
			(text) => `\x1b[38;5;7m${text}\x1b[39m`,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		expect(editor.getPaddingX()).toBe(1);
		expect(editor.render(40)[1]).toBe(" \x1b[38;5;7m❯\x1b[39m draft");
	});

	it("keeps leading spaces in the input after the reserved prompt slot", () => {
		class LeadingSpaceEditor extends FakeEditor {
			override render(_width: number): string[] {
				return ["top", `${" ".repeat(4)}   draft`, "bottom"];
			}
		}
		const PromptEditor = createPromptEditorClass(
			LeadingSpaceEditor as unknown as CustomEditorConstructor,
			(text) => `<${text}>`,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		expect(editor.render(40)[1]).toBe(" <❯>     draft");
	});

	it("adds vertical borders around full-width live input rows", () => {
		class FullWidthEditor extends FakeEditor {
			override render(width: number): string[] {
				const padding = " ".repeat(3);
				const contentWidth = width - padding.length * 2;
				const row = (content: string) => `${padding}${content}${" ".repeat(contentWidth - content.length)}${padding}`;
				return [this.renderTopBorder(width, 0), row("draft"), row("second"), this.renderBottomBorder(width, 0), "completion"];
			}
		}
		const PromptEditor = createPromptEditorClass(
			FullWidthEditor as unknown as CustomEditorConstructor,
			(text) => text,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const lines = editor.render(40);
		expect(lines[0]).toBe(`┌${"─".repeat(38)}┐`);
		expect(lines[1]).toMatch(/^│❯ draft/);
		expect(lines[1]?.endsWith("│")).toBe(true);
		expect(lines[1]).toHaveLength(40);
		expect(lines[2]?.startsWith(`│${" ".repeat(2)}second`)).toBe(true);
		expect(lines[2]?.endsWith("│")).toBe(true);
		expect(lines[2]).toHaveLength(40);
		expect(lines[3]).toBe(`└${"─".repeat(38)}┘`);
		expect(lines[4]).toBe("completion");
	});

	it("paints corners, rails and the bottom edge through the frame resolver", () => {
		class FullWidthEditor extends FakeEditor {
			override render(width: number): string[] {
				const padding = " ".repeat(3);
				const contentWidth = width - padding.length * 2;
				const row = (content: string) => `${padding}${content}${" ".repeat(contentWidth - content.length)}${padding}`;
				return [this.renderTopBorder(width, 0), row("draft"), this.renderBottomBorder(width, 0)];
			}
		}
		const asked: string[] = [];
		const PromptEditor = createPromptEditorClass(
			FullWidthEditor as unknown as CustomEditorConstructor,
			(text) => text,
			() => (text) => {
				asked.push(text);
				return `<frame>${text}</frame>`;
			},
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const lines = editor.render(20);
		expect(lines[0]).toMatch(/^<frame>┌<\/frame>/);
		expect(lines[0]).toMatch(/<frame>┐<\/frame>$/);
		expect(lines[1]).toMatch(/^<frame>│<\/frame>/);
		expect(lines[1]).toMatch(/<frame>│<\/frame>$/);
		expect(lines[2]).toMatch(/^<frame>└<\/frame>/);
		expect(asked).toContain("│");
	});

	it("falls back to the host border colour when no resolver is given", () => {
		class HostBorderEditor extends FakeEditor {
			constructor(...args: unknown[]) {
				super(...args);
				(this as unknown as { borderColor: (text: string) => string }).borderColor = (text) =>
					`<inherited>${text}</inherited>`;
			}
		}
		const PromptEditor = createPromptEditorClass(HostBorderEditor as unknown as CustomEditorConstructor, (text) => text);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		expect(editor.render(12)[0]).toMatch(/^<inherited>┌<\/inherited>/);
	});

	it("paints every dash itself when the host colours the border", () => {
		// pi-tui's Editor.renderTopBorder returns `borderColor(dashes)`, i.e. the whole
		// run is wrapped in the host's colour (thinking-level red at max). Repainting
		// only the corners leaves the red dashes in place; the middle is only correct
		// when each dash comes out carrying the frame colour.
		class WrappedBorderEditor extends FakeEditor {
			protected override renderTopBorder(width: number, hiddenLineCount: number): string {
				return `\x1b[31m${super.renderTopBorder(width, hiddenLineCount)}\x1b[39m`;
			}

			protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
				return `\x1b[31m${super.renderBottomBorder(width, hiddenLineCount)}\x1b[39m`;
			}
		}
		const PromptEditor = createPromptEditorClass(
			WrappedBorderEditor as unknown as CustomEditorConstructor,
			(text) => text,
			() => (text) => `\x1b[35m${text}\x1b[39m`,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const lines = editor.render(20);
		for (const line of [lines[0], lines[2]]) {
			// No dash may be left to the host: drop the frame's own paint and nothing
			// but the corners' siblings may remain.
			expect((line ?? "").split("\x1b[35m─\x1b[39m").join("")).not.toContain("─");
			expect(visibleWidth(line ?? "")).toBe(20);
		}
	});

	it("leaves the working status embedded in the top border untouched", () => {
		// pi-pretty forces embedWorkingStatus, so the host composes the top border as
		// borderColor("── ") + status + borderColor(" ──…") and the status is
		// pi-pretty's own indicator. Repainting the run wholesale flattens its shimmer.
		const status = "\x1b[1m\x1b[38;2;9;8;7m● Thinking\x1b[39m\x1b[22m";
		class StatusBorderEditor extends FakeEditor {
			protected override renderTopBorder(width: number, _hiddenLineCount: number): string {
				return `── ${status} ${"─".repeat(width - 14)}`;
			}
		}
		const ramp = (text: string, col: number): string => `\x1b[38;2;${col};0;0m${text}\x1b[39m`;
		const PromptEditor = createPromptEditorClass(
			StatusBorderEditor as unknown as CustomEditorConstructor,
			ramp,
			() => ramp,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const top = editor.render(40)[0] ?? "";
		// the indicator keeps its own bold + truecolor, byte for byte
		expect(top).toContain(status);
		// the ramp resumes at the right column: "── " + status(10 cols) + " " puts the
		// next dash in column 15, so the status width is counted, not guessed
		expect(top).toContain("\x1b[38;2;15;0;0m─");
		// and no dash is left outside the frame's paint
		let leftover = top;
		for (let column = 0; column <= 40; column += 1) {
			leftover = leftover.split(`\x1b[38;2;${column};0;0m─\x1b[39m`).join("");
		}
		expect(leftover).not.toContain("─");
		expect(visibleWidth(top)).toBe(40);
	});

	it("paints the frame and the icon through a positional gradient", () => {
		const ramp = (text: string, col: number): string => `\x1b[38;2;${col};0;0m${text}\x1b[39m`;
		const PromptEditor = createPromptEditorClass(
			fakeEditorClass,
			ramp,
			() => ramp,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const top = editor.render(20)[0];
		const colours = new Set(top.match(/\x1b\[38;2;\d+;0;0m/g) ?? []);
		expect(colours.size).toBeGreaterThan(2);
		expect(editor.render(20)[1]).toMatch(/\x1b\[38;2;1;0;0m❯/);
	});

	it("keeps the configured token when Pi assigns a thinking-level border", () => {
		// interactive-mode calls updateEditorBorderColor() at startup and on every theme
		// change, so a host assignment is the steady state, not a transient override.
		const PromptEditor = createPromptEditorClass(
			fakeEditorClass,
			(text) => text,
			() => (text) => `<frame>${text}</frame>`,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));
		expect(editor.render(12)[0]).toMatch(/^<frame>┌/);

		editor.borderColor = (text: string) => `<thinkingMax>${text}</thinkingMax>`;
		expect(editor.render(12)[0]).toMatch(/^<frame>┌/);
	});

	it("keeps every line at width when a scroll indicator rides the top border", () => {
		class ScrollingEditor extends FakeEditor {
			override render(width: number): string[] {
				const padding = " ".repeat(3);
				const contentWidth = width - padding.length * 2;
				const row = (content: string) => `${padding}${content}${" ".repeat(contentWidth - content.length)}${padding}`;
				return [this.renderTopBorder(width, 3), row("draft"), row("second"), this.renderBottomBorder(width, 0)];
			}

			protected override renderTopBorder(width: number, hiddenLineCount: number): string {
				if (hiddenLineCount === 0) return "─".repeat(width);
				const indicator = ` ↑ ${hiddenLineCount} `;
				return `─${indicator}${"─".repeat(width - 1 - indicator.length)}`;
			}
		}
		const PromptEditor = createPromptEditorClass(ScrollingEditor as unknown as CustomEditorConstructor, (text) => text);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		const lines = editor.render(40);
		expect(lines[0]?.startsWith("┌")).toBe(true);
		expect(lines[0]?.endsWith("┐")).toBe(true);
		expect(lines[0]).toContain("↑ 3");
		for (const line of lines) expect(visibleWidth(line)).toBe(40);
	});

	it("keeps the old prompt-only fallback when border hooks are unavailable", () => {
		class LegacyEditor {
			private padding = 0;

			constructor(..._args: unknown[]) {}

			getPaddingX(): number {
				return this.padding;
			}

			setPaddingX(padding: number): void {
				this.padding = padding;
			}

			render(_width: number): string[] {
				return ["top", `${" ".repeat(this.padding)}draft`, "bottom", "completion"];
			}
		}
		const PromptEditor = createPromptEditorClass(
			LegacyEditor as unknown as CustomEditorConstructor,
			(text) => text,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));

		expect(editor.render(40)).toEqual(["top", " ❯ draft", "bottom", "completion"]);
	});

	it("sweeps the banner five-stop ramp across the box at max thinking", async () => {
		vi.stubEnv("PRETTY_WORKING_INDICATOR", "off");
		let editorFactory: unknown;
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			registerMarkdownTransformer: () => {},
			registerFlag: () => {},
			registerTool: () => {},
			registerCommand: () => {},
			on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler),
		};
		const ui = {
			theme: {
				fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
				getThinkingBorderColor: (level: string) => (text: string) => `<thinking:${level}>${text}</thinking:${level}>`,
				colors: { accent: { r: 200, g: 100, b: 255 } },
			},
			setEditorComponent: (factory: unknown) => {
				editorFactory = factory;
			},
			getEditorComponent: () => undefined,
			setToolsExpanded: () => {},
			setWorkingVisible: () => {},
		};
		const ctx = {
			mode: "tui",
			cwd: process.cwd(),
			ui,
			thinkingLevel: "max",
			sessionManager: { getSessionName: () => undefined },
		};

		await piPrettyExtension(pi as never, { sdk: {}, customEditorClass: fakeEditorClass });
		await handlers.get("session_start")?.({}, ctx);

		const factory = editorFactory as (tui: unknown, theme: unknown, keybindings: unknown) => { render(w: number): string[] };
		const editor = factory(undefined, undefined, undefined);
		const [top, row] = editor.render(40);
		const shades = new Set(top?.match(/\x1b\[38;2;\d+;\d+;\d+m/g) ?? []);
		expect(shades.size).toBeGreaterThan(2);
		// the banner's own stops: cyan at column 0, orange at the last column
		expect(top).toContain("\x1b[38;2;34;211;238m┌");
		expect(top).toContain("\x1b[38;2;251;146;60m┐");
		expect(top).not.toContain("<thinking:max>");
		expect(row).toMatch(/\x1b\[38;2;\d+;\d+;\d+m❯/);
		expect(row).not.toContain("<thinking:max>❯");

		await handlers.get("session_shutdown")?.({}, ctx);
	});

	it("installs the prompt editor only through the host's public editor API", async () => {
		vi.stubEnv("PRETTY_WORKING_INDICATOR", "off");
		let editorFactory: unknown;
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			registerMarkdownTransformer: () => {},
			registerFlag: () => {},
			registerTool: () => {},
			registerCommand: () => {},
			on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, handler),
		};
		const ui = {
			theme: {
				fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
				getThinkingBorderColor: (level: string) => (text: string) => `<${level}>${text}</${level}>`,
			},
			setEditorComponent: (factory: unknown) => {
				editorFactory = factory;
			},
			getEditorComponent: () => undefined,
			setToolsExpanded: () => {},
			setWorkingVisible: () => {},
		};
		let thinkingLevel = "high";
		const ctx = {
			mode: "tui",
			cwd: process.cwd(),
			ui,
			get thinkingLevel() {
				return thinkingLevel;
			},
			sessionManager: { getSessionName: () => undefined },
		};

		await piPrettyExtension(pi as never, { sdk: {}, customEditorClass: fakeEditorClass });
		await handlers.get("session_start")?.({}, ctx);

		expect(typeof editorFactory).toBe("function");
		const factory = editorFactory as (tui: unknown, theme: unknown, keybindings: unknown) => {
			render(width: number): string[];
		};
		const editor = factory(undefined, undefined, undefined);
		expect(editor.render(40)[1]).toContain("<high>❯</high>");
		thinkingLevel = "low";
		expect(editor.render(40)[1]).toContain("<low>❯</low>");
		// max is the one level the banner ramp owns instead of the level colour
		thinkingLevel = "max";
		expect(editor.render(40)[1]).toMatch(/\x1b\[38;2;\d+;\d+;\d+m❯/);

		await handlers.get("session_shutdown")?.({}, ctx);
		expect(editorFactory).toBeUndefined();
	});
});
