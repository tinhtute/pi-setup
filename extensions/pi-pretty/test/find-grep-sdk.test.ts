import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFindTool } from "../src/tools/find.js";
import { registerGrepTool } from "../src/tools/grep.js";

// find/grep lost their only coverage when the FFF integration test went away in
// #20. These pin the part that survived: the tools are thin wrappers that run the
// host's SDK implementation and re-shape its output into `findResult`/`grepResult`
// details. If a future refactor drops the renderer or the details shape, this fails.

type Registered = { name: string; execute: (...args: any[]) => Promise<any> };

function capture(): { api: ExtensionAPI; tools: Map<string, Registered> } {
	const tools = new Map<string, Registered>();
	const api = {
		registerTool: (definition: Registered) => tools.set(definition.name, definition),
	} as unknown as ExtensionAPI;
	return { api, tools };
}

/** Minimal SDK tool definition; `execute` records that it was reached. */
function sdkTool(content: { type: string; text: string }[]) {
	const calls: unknown[] = [];
	return {
		calls,
		tool: {
			description: "sdk fixture",
			parameters: {},
			execute: async (...args: unknown[]) => {
				calls.push(args);
				return { content, details: {} };
			},
		},
	};
}

async function run(definition: Registered) {
	return definition.execute("call-1", {}, undefined, undefined, { state: {} });
}

describe("find over the SDK", () => {
	it("registers a self-rendering find tool that keeps the SDK description", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([]);
		registerFindTool(api, "/p", sdk.tool as never);
		const definition = tools.get("find");
		expect(definition).toBeDefined();
		expect((definition as unknown as { description: string }).description).toBe("sdk fixture");
	});

	it("executes the SDK tool and labels the result findResult", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "src/a.ts\nsrc/b.ts" }]);
		registerFindTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("find") as Registered);

		expect(sdk.calls).toHaveLength(1);
		expect(result.details).toMatchObject({ _type: "findResult", pattern: "", matchCount: 2 });
		expect(result.details.text).toBe("src/a.ts\nsrc/b.ts");
	});

	it("treats the SDK's empty answer as zero matches, not one line", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "No files found matching pattern" }]);
		registerFindTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("find") as Registered);

		expect(result.details).toMatchObject({ _type: "findResult", text: "", matchCount: 0 });
	});

	it("keeps the SDK's trailing notice block in details.notices", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "a.ts\n\n[100 entries limit reached. Use limit=200 for more]" }]);
		registerFindTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("find") as Registered);

		expect(result.details.text).toBe("a.ts");
		// The parser splits notices on sentence boundaries, so one SDK sentence
		// arrives as two entries. Pinned as-is: it is display-only text.
		expect(result.details.notices).toEqual(["100 entries limit reached", "Use limit=200 for more"]);
	});
});

describe("grep over the SDK", () => {
	it("executes the SDK tool and counts matched lines", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "a.ts:1:alpha\na.ts:2:beta" }]);
		registerGrepTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("grep") as Registered);

		expect(sdk.calls).toHaveLength(1);
		expect(result.details).toMatchObject({ _type: "grepResult", matchCount: 2 });
	});

	it("normalises the SDK's 'No matches found' to empty text", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "No matches found" }]);
		registerGrepTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("grep") as Registered);

		expect(result.details).toMatchObject({ _type: "grepResult", text: "", matchCount: 0 });
	});

	it("normalises CRLF in the SDK output before rendering", async () => {
		const { api, tools } = capture();
		const sdk = sdkTool([{ type: "text", text: "a.ts:1:alpha\r\na.ts:2:beta" }]);
		registerGrepTool(api, "/p", sdk.tool as never);

		const result = await run(tools.get("grep") as Registered);

		expect(result.content[0].text).not.toContain("\r");
	});
});
