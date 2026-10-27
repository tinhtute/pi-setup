import { describe, expect, it } from "vitest";
import { THEME_STOPS, normalizeStops } from "../src/indicator/stops.js";
import { accentRampHexes, resolveStops } from "../src/indicator/theme-stops.js";

/** `Theme.colors.accent` for the system theme on a dark terminal. */
const ACCENT = { kind: "rgb", r: 0xa3, g: 0x93, b: 0xd6 } as const;
const TEXT = { kind: "rgb", r: 0xd0, g: 0xd0, b: 0xd8 } as const;

describe("theme stops", () => {
	it("keeps the `theme` sentinel through config normalization", () => {
		expect(normalizeStops("theme")).toBe(THEME_STOPS);
	});

	it("still rejects everything that is neither hex nor the sentinel", () => {
		expect(normalizeStops(["#22d3ee"])).toBeUndefined();
		expect(normalizeStops("#22d3ee")).toBeUndefined();
		expect(normalizeStops(["accent", "dim"])).toBeUndefined();
		expect(normalizeStops(42)).toBeUndefined();
	});

	it("derives five stops from the theme accent, keeping its hue", () => {
		const stops = resolveStops(THEME_STOPS, { colors: { accent: ACCENT, text: TEXT } });
		// Dark → light around the accent; no cyan anywhere, which is the whole point.
		expect(stops).toEqual(["#5f557c", "#8276ab", "#a393d6", "#b7abdf", "#ccc4e8"]);
		for (const hex of stops ?? []) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
	});

	it("puts the accent itself in the middle, so the band's brightest cell is the theme colour", () => {
		const stops = resolveStops(THEME_STOPS, { colors: { accent: ACCENT } });
		expect(stops?.[2]).toBe("#a393d6");
	});

	it("falls back to the text token when the accent carries no channels", () => {
		// A 256-colour terminal hands back an indexed colour; text is the same story,
		// so the ramp has nothing to mix and the call reports "no gradient".
		expect(resolveStops(THEME_STOPS, { colors: { accent: { kind: "indexed", index: 4 } } })).toBeUndefined();
		expect(resolveStops(THEME_STOPS, { colors: { text: TEXT } })).toEqual(accentRampHexes(TEXT));
	});

	it("returns the explicit array untouched and nothing for a missing setting", () => {
		const hexes = ["#22d3ee", "#fb923c"];
		expect(resolveStops(hexes, { colors: { accent: ACCENT } })).toEqual(hexes);
		expect(resolveStops(undefined, { colors: { accent: ACCENT } })).toBeUndefined();
		expect(resolveStops(THEME_STOPS, undefined)).toBeUndefined();
		expect(resolveStops(THEME_STOPS, { colors: {} })).toBeUndefined();
	});

	it("keeps a single explicit stop a non-gradient", () => {
		// `normalizeStops` never returns one element, but the resolver is the last
		// guard: two colours are the minimum for an interpolation to exist.
		expect(resolveStops(["#22d3ee"], undefined)).toEqual(["#22d3ee"]);
	});
});
