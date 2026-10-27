/* pi-pretty: find tool -- pretty rendering over the host's SDK (fd) find. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BG_ERROR, FG_DIM, RST, resolveBaseBackground } from "../config.js";
import { shortPath } from "../helpers.js";
import {
	fillToolBackground,
	fillToolBody,
	rememberToolTitle,
	renderFindResults,
	renderToolDuration,
	renderToolError,
	setCollapsedToolTitle,
	toolIndent,
} from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { FindDetails, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";

type Result = AgentToolResult<Record<string, unknown>>;

function getText(result: Result): string {
	return (result.content ?? [])
		.filter((c) => c.type === "text")
		.map((c) => (c as TextContent).text ?? "")
		.join("\n");
}

function normalizeSdkFindOutput(text: string): { text: string; matchCount: number; notices: string[] } {
	const trimmed = text.trim();
	if (!trimmed || trimmed === "No files found matching pattern") {
		return { text: "", matchCount: 0, notices: [] };
	}

	const noticeMatch = /\n\n\[([^\r\n]*)\]\s*$/.exec(text);
	const body = noticeMatch ? text.slice(0, noticeMatch.index) : text;
	// The SDK emits one bracketed block of sentences (`[N entries limit reached.
	// Use limit=M for more]`). Keep it whole: splitting on `. ` cut a single notice
	// into two, and the renderer then re-joined them with `. ` — right for this
	// string, wrong for any notice containing an abbreviation, a version number,
	// or its own punctuation. One block is one notice.
	const trimmedNotice = noticeMatch?.[1].trim() ?? "";
	const notices = trimmedNotice ? [trimmedNotice] : [];
	const matchCount = body.trim() ? body.trim().split("\n").filter(Boolean).length : 0;
	return { text: body, matchCount, notices };
}

async function sdkFindAsFindResult(
	sdkTool: SdkToolDef,
	tid: string,
	params: Record<string, unknown>,
	sig: AbortSignal | undefined,
	ctx: ExtensionContext,
	pattern: string,
	extraNotices: string[],
): Promise<Result> {
	const result = (await sdkTool.execute(tid, params, sig, undefined, ctx)) as Result;
	const parsed = normalizeSdkFindOutput(getText(result));
	const prev = (result.details as FindDetails | undefined)?.notices ?? [];
	const notices = [...parsed.notices, ...(Array.isArray(prev) ? prev : []), ...extraNotices];
	result.details = {
		_type: "findResult",
		text: parsed.text,
		pattern,
		matchCount: parsed.matchCount,
		notices,
	};
	return result;
}

export function registerFindTool(
	pi: ExtensionAPI,
	cwd: string,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "find",
		label: "Find",
		description: sdkTool.description ?? "Find files matching a glob pattern",
		parameters: sdkTool.parameters,
		renderShell: "self",

		execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
			const pattern = String(params.pattern ?? "");

			return sdkFindAsFindResult(sdkTool, tid, params, sig, ctx, pattern, []);
		}),

		renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const a = args as { pattern?: unknown; path?: unknown; limit?: unknown };
			const text = (ctx as RenderCtxLike).lastComponent ?? new TC("", 0, 0);
			const pattern = a.pattern == null ? "" : String(a.pattern);
			const pathArg = a.path == null ? "<missing>" : shortPath(cwd, home, String(a.path));
			const limit = a.limit;
			const findLabel = theme.fg(ctx.isError ? "error" : "toolTitle", theme.bold("✱ find"));
			const patternPart = pattern ? theme.fg("toolTitle", pattern) : "";
			const inPart = theme.fg("dim", " in ");
			const pathPart = theme.fg("toolOutput", pathArg);
			const limitPart = limit !== undefined && limit !== null ? theme.fg("dim", ` limit ${limit}`) : "";
			const out = `${findLabel} ${patternPart}${inPart}${pathPart}${limitPart}`;
			const ind = toolIndent(ctx);
			const renderTitle = (suffix = ""): string =>
				fillToolBackground(`\n${ind}${out}${suffix}\n`, ctx.isError ? BG_ERROR : undefined, undefined, ind);
			rememberToolTitle(ctx, text, renderTitle);
			text.setText(renderTitle());
			return text;
		},

		renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
			resolveBaseBackground(theme);
			const r = result;
			const text = (ctx as RenderCtxLike).lastComponent ?? new TC("", 0, 0);
			const ind = toolIndent(ctx);
			if (ctx.isError) {
				text.setText(renderToolError(getText(r) || "Error", theme, ind));
				return text;
			}
			const d = r.details as FindDetails | undefined;
			if (d?._type === "findResult") {
				if (!d.text.trim()) {
					const notice = d.notices?.length ? ` ${theme.fg("warning", `[${d.notices.join(". ")}]`)}` : "";
					if (setCollapsedToolTitle(ctx, text, ` ${FG_DIM}0 files${RST}${notice}`)) return text;
					const noticeStr = d.notices?.length ? `\n${ind}${theme.fg("warning", `[${d.notices.join(". ")}]`)}` : "";
					text.setText(fillToolBody(`${ind}${theme.fg("dim", "0 files")}${noticeStr}`, undefined, undefined, ind));
					return text;
				}
				if (!ctx.expanded) {
					const duration = renderToolDuration(r, ctx);
					const summary = `${FG_DIM}${d.matchCount} files — ctrl+o to expand${RST}${duration ? `${FG_DIM}· ${duration}${RST}` : ""}`;
					if (setCollapsedToolTitle(ctx, text, ` ${summary}`)) return text;
					text.setText(fillToolBody(`${ind}${summary}`, undefined, undefined, ind));
					return text;
				}
				const rendered = renderFindResults(d.text, theme)
					.split("\n")
					.map((l) => `${ind}${l}`)
					.join("\n");
				const noticeStr = d.notices?.length ? `\n${ind}${theme.fg("warning", `[${d.notices.join(". ")}]`)}` : "";
				const duration = renderToolDuration(r, ctx);
				text.setText(
					fillToolBody(
						`${ind}${theme.fg("dim", `${d.matchCount} files`)}${duration ? `${FG_DIM}· ${duration}${RST}` : ""}\n${rendered}${noticeStr}`,
						undefined,
						undefined,
						ind,
					),
				);
				return text;
			}
			const fc = r.content?.[0] as TextContent | undefined;
			text.setText(
				fillToolBody(`${ind}${theme.fg("dim", fc?.text?.slice(0, 120) ?? "0 files")}`, undefined, undefined, ind),
			);
			return text;
		},
	} as unknown as ToolDefinition);
}
