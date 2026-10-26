import { describe, expect, it } from "vitest";
import { buildWorkingFrames } from "../src/indicator/frames.js";
import { resolveWorkingIndicatorSettings } from "../src/indicator/settings.js";
import { gradientAnsiAt, normalizeStops, resetGradientStopsForTests } from "../src/indicator/stops.js";

/**
 * Multi-stop gradient for the shimmer band.
 *
 * Upstream quantises a cell into one of three tiers, so a wide band reads as
 * three flat blocks. These tests assert the gradient actually produces more than
 * three distinct colours across one sweep, and that everything upstream did is
 * unchanged when no stops are configured.
 */

/** The setup's band. It lives in `config/pi-pretty.json`, not in the source, so
 *  tests carry their own copy rather than importing a default that does not exist. */
const BANNER_STOPS = ["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c"];

const ANSI = {
	low: "\x1b[38;2;40;40;40m",
	mid: "\x1b[38;2;90;90;90m",
	high: "\x1b[38;2;200;200;200m",
};

/** Every distinct `38;2;r;g;b` foreground sequence in a frame list. */
function distinctColors(frames: string[]): Set<string> {
	const out = new Set<string>();
	const re = new RegExp(`${String.fromCharCode(27)}\\[38;2;[0-9;]+m`, "g");
	for (const frame of frames) {
		for (const match of frame.matchAll(re)) out.add(match[0]);
	}
	return out;
}

describe("normalizeStops", () => {
	it("keeps valid hex stops", () => {
		expect(normalizeStops(["#22d3ee", "#fb923c"])).toEqual(["#22d3ee", "#fb923c"]);
	});

	it("rejects anything that is not 2+ hex colours", () => {
		expect(normalizeStops(undefined)).toBeUndefined();
		expect(normalizeStops([])).toBeUndefined();
		expect(normalizeStops(["#22d3ee"])).toBeUndefined();
		expect(normalizeStops(["#22d3ee", "accent"])).toBeUndefined();
		expect(normalizeStops("#22d3ee")).toBeUndefined();
	});

	it("drops the bad entries and keeps the good ones", () => {
		expect(normalizeStops(["#22d3ee", "nope", "#fb923c"])).toEqual(["#22d3ee", "#fb923c"]);
	});
});

describe("gradientAnsiAt", () => {
	it("returns each end stop exactly at 0 and 1", () => {
		resetGradientStopsForTests();
		expect(gradientAnsiAt(BANNER_STOPS, 0)).toBe("\x1b[38;2;34;211;238m"); // #22d3ee
		expect(gradientAnsiAt(BANNER_STOPS, 1)).toBe("\x1b[38;2;251;146;60m"); // #fb923c
	});

	it("interpolates between stops instead of snapping", () => {
		resetGradientStopsForTests();
		const seen = new Set<string>();
		for (let i = 0; i <= 100; i++) seen.add(gradientAnsiAt(BANNER_STOPS, i / 100));
		// 5 stops sampled 101 ways: far more than 5 distinct values.
		expect(seen.size).toBeGreaterThan(50);
	});

	it("clamps out-of-range and non-finite input", () => {
		resetGradientStopsForTests();
		expect(gradientAnsiAt(BANNER_STOPS, -5)).toBe(gradientAnsiAt(BANNER_STOPS, 0));
		expect(gradientAnsiAt(BANNER_STOPS, 5)).toBe(gradientAnsiAt(BANNER_STOPS, 1));
		expect(gradientAnsiAt(BANNER_STOPS, Number.NaN)).toBe(gradientAnsiAt(BANNER_STOPS, 0));
	});

	it("returns empty for fewer than two stops", () => {
		expect(gradientAnsiAt(["#22d3ee"], 0.5)).toBe("");
	});
});

describe("buildWorkingFrames with stops", () => {
	it("paints one colour per cell instead of three flat tiers", () => {
		resetGradientStopsForTests();
		// 8 cells in "Working…", so at most 8 distinct colours (plus the resting one).
		const { frames } = buildWorkingFrames(["Working…"], {
			mode: "shimmer",
			ansi: ANSI,
			stops: [...BANNER_STOPS],
			spinner: false,
		});
		const colors = distinctColors(frames);
		// Three tiers would cap at 3; a real per-cell gradient exceeds that.
		expect(colors.size).toBeGreaterThan(3);
		expect(colors.size).toBeLessThanOrEqual(9);
	});

	it("uses only integer SGR channels", () => {
		resetGradientStopsForTests();
		const { frames } = buildWorkingFrames(["abcdefghij"], {
			mode: "shimmer",
			ansi: ANSI,
			stops: [...BANNER_STOPS],
			spinner: false,
		});
		for (const color of distinctColors(frames)) {
			const channels = color.slice("\u001b[38;2;".length, -1).split(";");
			expect(channels).toHaveLength(3);
			for (const channel of channels) {
				// A fractional channel makes the terminal drop the whole sequence.
				expect(channel).toMatch(/^\d+$/);
			}
		}
	});

	it("keeps the resting colour when the band is off the text", () => {
		resetGradientStopsForTests();
		const { frames } = buildWorkingFrames(["abc"], {
			mode: "shimmer",
			ansi: ANSI,
			stops: [...BANNER_STOPS],
			spinner: false,
		});
		// The first frame has the band fully left of the text: all resting colour.
		expect(frames[0]).toBe(`\x1b[38;2;34;211;238mabc\x1b[39m`.replace("34;211;238", "40;40;40"));
	});

	it("falls back to exactly three tier colours without stops", () => {
		const { frames } = buildWorkingFrames(["Working…"], {
			mode: "shimmer",
			ansi: ANSI,
			spinner: false,
		});
		const colors = distinctColors(frames);
		expect(colors.size).toBeLessThanOrEqual(3);
	});

	it("keeps upstream output byte-identical when stops is absent", () => {
		const base = { mode: "shimmer" as const, ansi: ANSI, spinner: false };
		const without = buildWorkingFrames(["Working…"], base);
		const withEmpty = buildWorkingFrames(["Working…"], { ...base, stops: [] });
		expect(withEmpty.frames).toEqual(without.frames);
	});

	it("ignores a single-stop list (not a gradient)", () => {
		const base = { mode: "shimmer" as const, ansi: ANSI, spinner: false };
		const without = buildWorkingFrames(["Working…"], base);
		const withOne = buildWorkingFrames(["Working…"], { ...base, stops: ["#22d3ee"] });
		expect(withOne.frames).toEqual(without.frames);
	});
});

/**
 * `stops` in the settings resolver. Absent (or unusable) means "no gradient": the
 * three tiers stay, which is what keeps `sessionAccent` meaningful. That is
 * deliberate — see the byte-identical-upstream test above.
 */
describe("resolveWorkingIndicatorSettings stops", () => {
	it("leaves stops undefined when the key is absent, so the three tiers stay", () => {
		const settings = resolveWorkingIndicatorSettings({ mode: "shimmer", text: "Working…" }, {});
		expect(settings.stops).toBeUndefined();
	});

	it("keeps a configured list verbatim", () => {
		const settings = resolveWorkingIndicatorSettings(
			{ mode: "shimmer", text: "Working…", stops: ["#22d3ee", "#fb923c"] },
			{},
		);
		expect(settings.stops).toEqual(["#22d3ee", "#fb923c"]);
	});

	it("treats an explicit empty list as opting out of the gradient", () => {
		const settings = resolveWorkingIndicatorSettings({ mode: "shimmer", text: "Working…", stops: [] }, {});
		expect(settings.stops).toBeUndefined();
	});

	it("treats a single stop as opting out, not as a one-colour gradient", () => {
		const settings = resolveWorkingIndicatorSettings({ mode: "shimmer", text: "Working…", stops: ["#22d3ee"] }, {});
		expect(settings.stops).toBeUndefined();
	});

	it("drops invalid entries but keeps a usable pair", () => {
		const settings = resolveWorkingIndicatorSettings(
			{ mode: "shimmer", text: "Working…", stops: ["#22d3ee", "accent", "#fb923c"] },
			{},
		);
		expect(settings.stops).toEqual(["#22d3ee", "#fb923c"]);
	});
});
