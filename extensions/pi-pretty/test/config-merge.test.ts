import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const homes: string[] = [];

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function makeConfigDir(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-pretty-config-"));
	writeFileSync(join(dir, "pi-pretty.json"), contents);
	homes.push(dir);
	return dir;
}

function makeEmptyDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-pretty-config-empty-"));
	homes.push(dir);
	return dir;
}

/** Fresh module instance so env-stubbed module-level bindings reset per test. */
async function freshModule<T>(path: string): Promise<T> {
	vi.resetModules();
	return (await import(path)) as T;
}

describe("normalizeToolList", () => {
	it("trims, lowercases, and drops non-strings and empties", async () => {
		const { normalizeToolList } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		expect(normalizeToolList([" LS ", "grep", 1, null, ""])).toEqual(["ls", "grep"]);
		expect(normalizeToolList("ls")).toEqual([]);
		expect(normalizeToolList(undefined)).toEqual([]);
	});
});

describe("loadConfig", () => {
	it("parses and validates all supported keys", async () => {
		const { loadConfig } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		const dir = makeConfigDir(
			JSON.stringify({
				background: { tool: "#1e1e2e", error: "#2a1e1e" },
				theme: "github-dark",
				disableTools: ["grep"],
				maxHlChars: 42,
				maxPreviewLines: 10,
				cacheLimit: 5,
			}),
		);
		expect(loadConfig(dir)).toEqual({
			background: { tool: "#1e1e2e", error: "#2a1e1e" },
			theme: "github-dark",
			disableTools: ["grep"],
			maxHlChars: 42,
			maxPreviewLines: 10,
			cacheLimit: 5,
		});
	});

	it("silently drops invalid fields", async () => {
		const { loadConfig } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		const dir = makeConfigDir(
			JSON.stringify({
				background: { tool: "not-a-color", error: "#123456" },
				theme: 42,
				disableTools: [1, null],
				maxHlChars: 0,
				maxPreviewLines: -1,
				cacheLimit: 1.5,
			}),
		);
		expect(loadConfig(dir)).toEqual({ background: { error: "#123456" } });
	});

	it("returns {} for a missing or malformed config file", async () => {
		const { loadConfig } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		expect(loadConfig(makeEmptyDir())).toEqual({});
		expect(loadConfig(makeConfigDir("{not json"))).toEqual({});
	});

	it("returns {} when the config directory override is empty", async () => {
		vi.stubEnv("PRETTY_CONFIG_DIR", "");
		const { loadConfig } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		expect(loadConfig()).toEqual({});
	});

	it("reads ~/.pi/agent from os.homedir() when HOME is unset (Windows)", async () => {
		const home = makeEmptyDir();
		mkdirSync(join(home, ".pi", "agent"), { recursive: true });
		writeFileSync(join(home, ".pi", "agent", "pi-pretty.json"), JSON.stringify({ disableTools: ["grep"] }));
		vi.stubEnv("HOME", "");
		vi.stubEnv("PRETTY_CONFIG_DIR", undefined);
		vi.doMock("node:os", async (importOriginal) => ({
			...(await importOriginal<typeof import("node:os")>()),
			homedir: () => home,
		}));
		const config = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		vi.doUnmock("node:os");
		expect(config.getDefaultAgentDir()).toBe(join(home, ".pi", "agent"));
		expect(config.loadConfig()).toEqual({ disableTools: ["grep"] });
	});
});

describe("applyConfig", () => {
	it("applies config values when env vars are unset", async () => {
		vi.stubEnv("PRETTY_MAX_HL_CHARS", "");
		vi.stubEnv("PRETTY_MAX_PREVIEW_LINES", "");
		vi.stubEnv("PRETTY_CACHE_LIMIT", "");
		const config = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		config.applyConfig({ maxHlChars: 42, maxPreviewLines: 10, cacheLimit: 5 });
		expect(config.MAX_HL_CHARS).toBe(42);
		expect(config.MAX_PREVIEW_LINES).toBe(10);
		expect(config.CACHE_LIMIT).toBe(5);
	});

	it("keeps env values when env vars are set", async () => {
		vi.stubEnv("PRETTY_MAX_HL_CHARS", "999");
		const config = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		config.applyConfig({ maxHlChars: 42 });
		expect(config.MAX_HL_CHARS).toBe(999);
	});
});

describe("resolveToolSets", () => {
	it("prefers a non-empty env set over the config array", async () => {
		const { resolveToolSets } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		expect(resolveToolSets(new Set(["read"]), { disableTools: ["grep"] })).toEqual({
			disabledTools: new Set(["read"]),
		});
	});

	it("falls back to the config array when the env set is empty", async () => {
		const { resolveToolSets } = await freshModule<typeof import("../src/config.js")>("../src/config.js");
		expect(resolveToolSets(new Set(), { disableTools: ["grep"] })).toEqual({
			disabledTools: new Set(["grep"]),
		});
	});
});

describe("getTheme", () => {
	it("uses the theme from pi-pretty.json when env is unset", async () => {
		vi.stubEnv("PRETTY_THEME", "");
		vi.stubEnv("PRETTY_CONFIG_DIR", makeConfigDir(JSON.stringify({ theme: "github-light" })));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const render = await freshModule<typeof import("../src/render.js")>("../src/render.js");
		expect(render.getTheme()).toBe("github-light");
		expect(warn).not.toHaveBeenCalled();
	});

	it("warns and falls back for an invalid config theme", async () => {
		vi.stubEnv("PRETTY_THEME", "");
		vi.stubEnv("PRETTY_CONFIG_DIR", makeConfigDir(JSON.stringify({ theme: "dark" })));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const render = await freshModule<typeof import("../src/render.js")>("../src/render.js");
		expect(render.getTheme()).toBe("github-dark");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('theme "dark" from pi-pretty.json'));
	});

	it("lets PRETTY_THEME override the config theme", async () => {
		vi.stubEnv("PRETTY_THEME", "github-dark");
		vi.stubEnv("PRETTY_CONFIG_DIR", makeConfigDir(JSON.stringify({ theme: "github-light" })));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const render = await freshModule<typeof import("../src/render.js")>("../src/render.js");
		expect(render.getTheme()).toBe("github-dark");
		expect(warn).not.toHaveBeenCalled();
	});
});
