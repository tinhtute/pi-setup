import { Loader } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installGradientLabels, uninstallGradientLabels } from "../src/indicator/gradient.js";
import { resolveWorkingIndicatorSettings, WORKING_INDICATOR_DEFAULTS } from "../src/indicator/settings.js";

/**
 * Host labels (compacting / retry / summarize / the plain Working row the host
 * restores after a reload) go through Loader.setMessage, not through
 * installWorkingIndicator. These tests assert that seam actually intercepts them:
 * a Loader subclass must end up holding pre-baked gradient frames instead of one
 * flat-coloured string.
 */

const SGR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(SGR_RE, "");

/** Minimal TUI stand-in so Loader's requestRender has somewhere to land. */
const tui = { requestRender() {} } as never;

/** A Loader stands in for the host's unexported Working/Compaction/Retry classes,
 *  which all inherit from it. */
function hostLoader(message: string): Loader {
	return new Loader(
		tui,
		(s) => s,
		(s) => s,
		message,
	);
}

const settings = resolveWorkingIndicatorSettings(
	{ enabled: true, text: "Working…", mode: "shimmer", low: "#102030", mid: "#405060", high: "#708090" },
	{},
);

beforeEach(() => {
	uninstallGradientLabels();
});

afterEach(() => {
	uninstallGradientLabels();
});

describe("gradient labels", () => {
	it("turns a host label into animated frames instead of leaving it flat", () => {
		installGradientLabels({ settings, getTheme: () => undefined });

		const loader = hostLoader("Compacting context... (esc to cancel)");
		const before = loader.render(120).join("\n");
		// Baseline: the host's own rendering carries no per-cell colour.
		expect(stripAnsi(before)).toContain("Compacting context");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting on SGR output is the point
		expect(before).not.toMatch(/\x1b\[38;2;/);

		// The host later updates the message (retry countdown does exactly this).
		loader.setMessage("Retrying (1/3) in 5s... (esc to cancel)");

		const rendered = loader.render(120).join("\n");
		// Text survives, but now wrapped in per-tier ANSI rather than one flat string.
		expect(stripAnsi(rendered)).toContain("Retrying (1/3) in 5s...");
		// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting on SGR output is the point
		expect(rendered).toMatch(/\x1b\[38;2;/);
	});

	it("produces more than one distinct frame so the label actually moves", () => {
		// The frames advance on Loader's own timer, not on setMessage. Drive it.
		vi.useFakeTimers();
		try {
			installGradientLabels({ settings, getTheme: () => undefined });
			const loader = hostLoader("Compacting context...");
			loader.setMessage("Compacting context...");

			const frames = new Set<string>();
			for (let i = 0; i < 12; i++) {
				frames.add(loader.render(200).join("\n"));
				vi.advanceTimersByTime(33);
			}
			expect(frames.size).toBeGreaterThan(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("leaves an empty message alone — that is pi-pretty's own managed row", () => {
		installGradientLabels({ settings, getTheme: () => undefined });

		// A pristine Loader shows its default spinner even with an empty message;
		// patched and unpatched must agree, i.e. we adopted no gradient frames here.
		const pristine = hostLoader("");
		const patched = hostLoader("");
		patched.setMessage("");
		expect(patched.render(120)).toEqual(pristine.render(120));
	});

	it("does not double-patch when installed twice", () => {
		installGradientLabels({ settings, getTheme: () => undefined });
		const once = Loader.prototype.setMessage;
		installGradientLabels({ settings, getTheme: () => undefined });
		expect(Loader.prototype.setMessage).toBe(once);
	});

	it("restores the host method on uninstall", () => {
		const pristine = Loader.prototype.setMessage;
		installGradientLabels({ settings, getTheme: () => undefined });
		expect(Loader.prototype.setMessage).not.toBe(pristine);

		uninstallGradientLabels();
		expect(Loader.prototype.setMessage).toBe(pristine);
	});

	it("sticks to one flat message when the label cannot be framed", () => {
		// "static" mode returns a single frame; the label must still show, unanimated.
		const staticSettings = { ...WORKING_INDICATOR_DEFAULTS, mode: "static" as const, texts: ["x"] };
		installGradientLabels({ settings: staticSettings, getTheme: () => undefined });

		const loader = hostLoader("Summarizing branch...");
		loader.setMessage("Summarizing branch...");
		expect(stripAnsi(loader.render(120).join(""))).toContain("Summarizing branch");
	});

	it("reads the theme at build time, so a theme swap changes the colours", () => {
		const seen: Array<unknown> = [];
		const themeA = { getFgAnsi: () => "\x1b[38;2;1;1;1m" };
		const themeB = { getFgAnsi: () => "\x1b[38;2;2;2;2m" };
		installGradientLabels({
			settings,
			getTheme: () => {
				const t = seen.length === 0 ? themeA : themeB;
				seen.push(t);
				return t as never;
			},
		});

		const first = hostLoader("Compacting context...");
		first.setMessage("Compacting context...");
		const firstOut = first.render(120).join("\n");

		seen.length = 0;
		const config = {
			enabled: true,
			mode: "shimmer" as const,
			text: "Other label",
			low: "dim",
			mid: "muted",
			high: "accent",
		};
		installGradientLabels({ settings: resolveWorkingIndicatorSettings(config, {}), getTheme: () => themeB as never });
		const second = hostLoader("Retrying (1/2) in 4s...");
		second.setMessage("Retrying (1/2) in 4s...");
		const secondOut = second.render(120).join("\n");

		expect(firstOut).not.toBe(secondOut);
	});

	it("rebuilds the same label after re-install, so a theme swap is not served from cache", () => {
		const themeSettings = resolveWorkingIndicatorSettings(
			{ enabled: true, mode: "shimmer", text: "Working…", low: "dim", mid: "muted", high: "accent" },
			{},
		);
		const themeA = { getFgAnsi: () => "\x1b[38;2;1;1;1m" };
		const themeB = { getFgAnsi: () => "\x1b[38;2;2;2;2m" };

		installGradientLabels({ settings: themeSettings, getTheme: () => themeA as never });
		const first = hostLoader("Compacting context...");
		first.setMessage("Compacting context...");
		const firstOut = first.render(120).join("\n");

		// Same label text, new theme: the cached frames must not win.
		installGradientLabels({ settings: themeSettings, getTheme: () => themeB as never });
		const second = hostLoader("Compacting context...");
		second.setMessage("Compacting context...");
		const secondOut = second.render(120).join("\n");

		expect(firstOut).not.toBe(secondOut);
	});
});
