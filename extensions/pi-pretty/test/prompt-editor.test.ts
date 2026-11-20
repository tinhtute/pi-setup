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

	it("lets a host-assigned border colour win over the configured token", () => {
		const PromptEditor = createPromptEditorClass(
			fakeEditorClass,
			(text) => text,
			() => (text) => `<frame>${text}</frame>`,
		);
		const editor = new PromptEditor(...([] as unknown as ConstructorParameters<CustomEditorConstructor>));
		expect(editor.render(12)[0]).toMatch(/^<frame>┌/);

		editor.borderColor = (text: string) => `<thinking>${text}</thinking>`;
		expect(editor.render(12)[0]).toMatch(/^<thinking>┌/);
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
		let thinkingLevel = "max";
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
		expect(editor.render(40)[1]).toContain("<max>❯</max>");
		thinkingLevel = "high";
		expect(editor.render(40)[1]).toContain("<high>❯</high>");

		await handlers.get("session_shutdown")?.({}, ctx);
		expect(editorFactory).toBeUndefined();
	});
});
