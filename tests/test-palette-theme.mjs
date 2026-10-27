// Run from the repo root: node tests/test-palette-theme.mjs
// Headless check of which colours follow the theme and which are fixed on purpose:
//
//   * the banner keeps its own rainbow — the header is a signature, not a status
//     surface, so its five colours never come from the theme;
//   * every gradient surface that reflects state — the working row, the loader
//     labels, the hidden-thinking row — takes `stops: "theme"`, a five-step ramp
//     around the active theme's accent, so `/theme` repaints them;
//   * the band's resting colour is the theme token `dim`, which is the part that
//     used to be the cyan theme's `#4d788e`.
//
// The extensions are TypeScript and cannot be imported here, so this pins the
// behaviour-carrying lines and mirrors the ramp against the real pi-tui helpers —
// same approach as tests/test-confirm-guard.mjs.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, repo), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

const RAINBOW = ["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c"];

// ---------------------------------------------------------------------------
// 1. Shipped configs: theme-derived band, theme-token resting colour.
// ---------------------------------------------------------------------------
for (const [label, configPath] of [
	["repo", "config/pi-pretty.json"],
	["live", path.join(homedir(), ".pi/agent/pi-pretty.json")],
]) {
	if (label === "live" && !existsSync(configPath)) continue;
	const config = JSON.parse(readFileSync(configPath, "utf8"));
	assert.equal(config.workingIndicator.low, "dim", `${label}: low must be the theme token dim`);
	assert.equal(
		config.workingIndicator.stops,
		"theme",
		`${label}: the band must follow the theme accent, not a fixed hex list`,
	);
}

// The default theme is the generated one, so nothing pins cyan for a fresh install.
assert.equal(readJson("config/settings.json").theme, "system", "the repo default theme is system");

// ---------------------------------------------------------------------------
// 2. The banner owns the rainbow; it must not drift onto theme colours.
// ---------------------------------------------------------------------------
const banner = read("extensions/custom-banner.ts");
for (const hex of RAINBOW) {
	assert(banner.includes(hex), `custom-banner.ts keeps its own ${hex}`);
}
assert.match(banner, /const PALETTE = \["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c"\]\.map\(parseColor\);/);
assert(!/theme\.colors\.accent/.test(banner), "the banner must not derive its colours from the theme");

// ---------------------------------------------------------------------------
// 3. The resting colour is a theme token, not a leftover hex.
// ---------------------------------------------------------------------------
const palette = read("extensions/pi-pretty/src/indicator/palette.ts");
assert.match(palette, /const hex = hexToAnsiFg\(value\);/, "an explicit hex still wins for low/mid/high");
assert.match(read("extensions/pi-pretty/src/indicator/settings.ts"), /palette: \{ low: "dim", mid: "muted", high: "accent" \}/);

// The theme-derived ramp is what ships, and every consumer must resolve it — a raw
// sentinel would reach the interpolator as a string.
const stopsSrc = read("extensions/pi-pretty/src/indicator/stops.ts");
const resolverSrc = read("extensions/pi-pretty/src/indicator/theme-stops.ts");
assert.match(stopsSrc, /export const THEME_STOPS = "theme";/);
assert.match(resolverSrc, /export const RAMP_STEPS: readonly number\[\] = \[-0\.42, -0\.2, 0, 0\.22, 0\.45\];/);
assert.match(
	resolverSrc,
	/colors\?\.accent \? accentRampHexes\(colors\.accent\)/,
	"the band derives from the theme accent, which is the theme's primary colour",
);
for (const consumer of ["install.ts", "thinking-label.ts", "gradient.ts"]) {
	const src = read(`extensions/pi-pretty/src/indicator/${consumer}`);
	assert.match(src, /resolveStops\(/, `${consumer} must resolve the stops`);
	assert(!/stops: (settings|workSettings)\.stops\b/.test(src), `${consumer} must not pass the raw sentinel through`);
}

// ---------------------------------------------------------------------------
// 4. pi-tui's own mixing produces the same five hexes as the resolver's arithmetic.
// ---------------------------------------------------------------------------
function findPiTui() {
	const candidates = [];
	const managed = process.env.PI_MANAGED_INSTALL_ROOT ?? path.join(homedir(), ".pi/agent/install");
	const releases = path.join(managed, "releases");
	if (existsSync(releases)) {
		for (const version of readdirSync(releases)) {
			candidates.push(path.join(releases, version, "node_modules"));
		}
	}
	const miseRoot = path.join(homedir(), ".local", "share", "mise", "installs", "node");
	if (existsSync(miseRoot)) {
		for (const version of readdirSync(miseRoot)) {
			candidates.push(path.join(miseRoot, version, "lib", "node_modules"));
		}
	}
	try {
		candidates.push(execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
	} catch {}
	candidates.push("/opt/homebrew/lib/node_modules", "/usr/local/lib/node_modules");
	for (const root of candidates) {
		for (const nested of ["", path.join("@earendil-works", "pi-coding-agent", "node_modules")]) {
			const tui = path.join(root, nested, "@earendil-works", "pi-tui", "dist", "index.js");
			if (existsSync(tui)) return tui;
		}
	}
	return undefined;
}

const ACCENT = [0xa3, 0x93, 0xd6];
const EXPECTED = ["#5f557c", "#8276ab", "#a393d6", "#b7abdf", "#ccc4e8"];
const STEPS = [-0.42, -0.2, 0, 0.22, 0.45];

/** Mirror of accentRampHexes() in src/indicator/theme-stops.ts. */
function rampHexes([r, g, b]) {
	const hex2 = (value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
	const mix = (channel, amount) => (amount < 0 ? channel * (1 + amount) : channel + (255 - channel) * amount);
	return STEPS.map((amount) => `#${hex2(mix(r, amount))}${hex2(mix(g, amount))}${hex2(mix(b, amount))}`);
}

assert.deepEqual(rampHexes(ACCENT), EXPECTED, "the mirrored opt-in ramp produces the documented stops");

const tuiPath = findPiTui();
if (tuiPath) {
	const { colorToHex, indexedColor, mixColors, parseColor, rgbColor } = await import(pathToFileURL(tuiPath).href);
	const accent = rgbColor(...ACCENT);
	const black = parseColor("#000000");
	const white = parseColor("#ffffff");
	const viaTui = STEPS.map((amount) =>
		amount < 0 ? colorToHex(mixColors(accent, black, -amount, "srgb")) : colorToHex(mixColors(accent, white, amount, "srgb")),
	);
	assert.deepEqual(viaTui, EXPECTED, "pi-tui's srgb mixing agrees with the resolver's arithmetic");
	// A 256-colour terminal still yields a mixable colour, so the ramp never vanishes.
	assert.match(colorToHex(indexedColor(4)), /^#[0-9a-f]{6}$/);
} else {
	console.log("SKIP: pi-tui not found on this machine (no Pi install); ramp equivalence unchecked");
}

// ---------------------------------------------------------------------------
// 5. The docs describe what ships.
// ---------------------------------------------------------------------------
const readme = read("README.md");
assert.match(readme, /"low": "dim"/, "README documents the token resting colour");
assert.match(readme, /"stops": "theme"/, "README documents the theme-derived band");
assert.match(readme, /#22d3ee/, "README still documents the banner's own rainbow");
assert.match(
	read("extensions/pi-pretty/pi-pretty.example.json"),
	/"stops": "theme"/,
	"the example config ships the theme-derived band",
);
assert.match(
	read("extensions/pi-pretty/README.md"),
	/`"theme"`/,
	"the pi-pretty README documents the sentinel",
);

console.log("ok: the banner keeps its rainbow, everything else follows the theme accent");
