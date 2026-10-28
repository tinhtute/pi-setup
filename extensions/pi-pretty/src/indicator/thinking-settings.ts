/**
 * Configuration for the animated hidden-thinking label.
 */

import type { ThinkingIndicatorConfig } from "../config.js";
import { envFlag } from "./env.js";

// ─── Thinking label ───────────────────────────────────────────────────────────

export interface ThinkingIndicatorSettings {
	enabled: boolean;
	/** Label refresh interval in ms. Default: WORKING_INTERVAL_MS (33). Higher = fewer
	 * full-tree renders per second while thinking — the main FPS lever on long sessions. */
	intervalMs?: number;
}

export const THINKING_INDICATOR_DEFAULTS: ThinkingIndicatorSettings = { enabled: true };

/**
 * Resolve thinking-label shimmer settings from `pi-pretty.json`'s
 * `thinkingIndicator` object and env overrides (env > config > default).
 */
export function resolveThinkingIndicatorSettings(
	config: ThinkingIndicatorConfig | undefined,
	env: NodeJS.ProcessEnv = process.env,
): ThinkingIndicatorSettings {
	const settings: ThinkingIndicatorSettings = { ...THINKING_INDICATOR_DEFAULTS };
	const envEnabled = envFlag(env.PRETTY_THINKING_INDICATOR);
	if (envEnabled !== undefined) settings.enabled = envEnabled;
	else if (typeof config?.enabled === "boolean") settings.enabled = config.enabled;
	const envInterval = Number.parseInt(env.PRETTY_THINKING_INTERVAL_MS ?? "", 10);
	if (Number.isFinite(envInterval) && envInterval >= 33) settings.intervalMs = envInterval;
	else if (typeof config?.intervalMs === "number" && config.intervalMs >= 33) settings.intervalMs = config.intervalMs;
	return settings;
}
