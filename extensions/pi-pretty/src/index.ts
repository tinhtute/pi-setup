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

const DEFAULT_DISABLED_TOOLS = new Set(["ls"]);
const USER_MESSAGE_ICON = "❯";

function envTools(name: "PRETTY_DISABLE_TOOLS" | "PRETTY_ENABLE_TOOLS"): Set<string> {
	return new Set(normalizeToolList((process.env[name] ?? "").split(",")));
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
	const { disabledTools, enabledTools } = resolveToolSets(
		envTools("PRETTY_DISABLE_TOOLS"),
		envTools("PRETTY_ENABLE_TOOLS"),
		config,
	);
	const isToolEnabled = (name: string) => {
		const normalizedName = name.toLowerCase();
		return (
			!disabledTools.has(normalizedName) &&
			(!DEFAULT_DISABLED_TOOLS.has(normalizedName) || enabledTools.has(normalizedName))
		);
	};
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
