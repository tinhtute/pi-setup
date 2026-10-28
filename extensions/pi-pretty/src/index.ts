/**
 * pi-pretty — Pretty terminal output for pi built-in tools.
 *
 * Enhances read, bash, find, and grep with:
 *   • Syntax-highlighted file content (Shiki)
 *   • Colored bash exit status + output
 *   • Custom ANSI rendering for all tools
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyConfig, loadConfig, normalizeToolList, resolveToolSets } from "./config.js";
import { installSessionLifecycle } from "./lifecycle/session.js";
import { registerPrettyTools } from "./lifecycle/tools.js";
import type { PiPrettyDeps } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USER_MESSAGE_ICON = "❯";

function envTools(): Set<string> {
	return new Set(normalizeToolList((process.env.PRETTY_DISABLE_TOOLS ?? "").split(",")));
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export type { PiPrettyDeps };

export default async function piPrettyExtension(pi: ExtensionAPI, deps?: PiPrettyDeps): Promise<void> {
	const config = loadConfig();
	applyConfig(config);
	pi.registerMarkdownTransformer?.((markdown, context) => {
		if (context.messageType !== "user" || markdown.trim() === "") return markdown;
		return ` ${USER_MESSAGE_ICON} ${markdown}`;
	});
	const { disabledTools } = resolveToolSets(envTools(), config);
	const isToolEnabled = (name: string) => !disabledTools.has(name.toLowerCase());
	const cwd = process.cwd();

	// Text component for custom rendering (DI-friendly)
	const TextComp = deps?.TextComponent;

	installSessionLifecycle({ pi, config, deps });

	registerPrettyTools({
		pi,
		cwd,
		isToolEnabled,
		textComponent: TextComp,
		depsSdk: deps?.sdk,
	});
}
