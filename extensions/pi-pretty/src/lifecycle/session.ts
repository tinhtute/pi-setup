/**
 * Everything that has to be wired at session granularity: the working row, the
 * animated hidden-thinking label, and the prompt editor.
 *
 * Split out of index.ts because this is the only part of the extension that owns
 * mutable per-session state. Keeping it in one place makes the lifecycle
 * (install -> start -> complete -> shutdown) readable in a single file instead of
 * interleaved with tool registration.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import * as hostSdk from "@earendil-works/pi-coding-agent";
import { getDefaultAgentDir, type PrettyConfig } from "../config.js";
import { installGradientLabels, uninstallGradientLabels } from "../indicator/gradient.js";
import { createPromptEditorClass } from "../prompt-editor.js";
import type { PiPrettyDeps } from "../types.js";
import {
	createThinkingLabelAnimator,
	createThinkingTimer,
	installPerRowThinkingLabels,
	installWorkingIndicator,
	type PerRowThinkingLabels,
	resolveThinkingIndicatorSettings,
	resolveWorkingIndicatorSettings,
	type ThinkingTimer,
	thinkingBlockActive,
	WORKING_INTERVAL_MS,
	type WorkingIndicatorController,
	type WorkingThemeLike,
} from "../working-indicator.js";

type EditorFactory = Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0];
type EditorUiCompatibility = {
	setEditorComponent?: (factory: EditorFactory) => void;
	getEditorComponent?: () => EditorFactory;
};

export interface SessionLifecycleOptions {
	pi: ExtensionAPI;
	config: PrettyConfig;
	deps?: PiPrettyDeps;
}

export function installSessionLifecycle(options: SessionLifecycleOptions): void {
	const { pi, config, deps } = options;

	const workingSettings = resolveWorkingIndicatorSettings(config.workingIndicator);
	const thinkingSettings = resolveThinkingIndicatorSettings(config.thinkingIndicator);
	let workingController: WorkingIndicatorController | undefined;
	let thinkingTimer: ThinkingTimer | undefined;
	let thinkingInterval: ReturnType<typeof setInterval> | undefined;
	let thinkingLastMessage: unknown;
	let thinkingHiddenCheckedAt = 0;
	let workingStreaming = false;
	let promptEditorInstalled = false;
	let previousEditorFactory: EditorFactory;
	const hostCustomEditor =
		deps?.customEditorClass ??
		(hostSdk as unknown as { CustomEditor?: PiPrettyDeps["customEditorClass"] }).CustomEditor;
	const installPromptEditor = (ctx: ExtensionContext): void => {
		if (ctx.mode !== "tui" || promptEditorInstalled || typeof hostCustomEditor !== "function") return;
		const editorUi = ctx.ui as unknown as EditorUiCompatibility;
		if (typeof editorUi.setEditorComponent !== "function") return;
		previousEditorFactory = editorUi.getEditorComponent?.();
		const PromptEditor = createPromptEditorClass(hostCustomEditor, (icon) => {
			const theme = ctx.ui.theme;
			return typeof theme.getThinkingBorderColor === "function"
				? theme.getThinkingBorderColor(ctx.thinkingLevel ?? "off")(icon)
				: theme.fg("thinkingText", icon);
		});
		editorUi.setEditorComponent((tui, theme, keybindings) => new PromptEditor(tui, theme, keybindings));
		promptEditorInstalled = true;
	};
	let perRowLabels: PerRowThinkingLabels | undefined;
	/** Accumulated thinking time per message timestamp — later runs in the same
	 * message resume from this total instead of rewinding to zero. */
	const thinkingElapsedMs = new Map<number, number>();

	/** Message timestamps are the per-row identity the label patch keys on. */
	const messageTimestamp = (message: unknown): number | undefined => {
		const ts = (message as { timestamp?: unknown } | undefined)?.timestamp;
		return typeof ts === "number" ? ts : undefined;
	};

	/** pi persists the thinking-visibility toggle as a top-level settings key. */
	const thinkingHidden = (): boolean => {
		try {
			const parsed = JSON.parse(readFileSync(join(getDefaultAgentDir(), "settings.json"), "utf8")) as {
				hideThinkingBlock?: unknown;
			};
			return parsed.hideThinkingBlock === true;
		} catch {
			return false;
		}
	};

	/**
	 * True when the 500ms-cached hidden check is stale and settings now show
	 * thinking revealed — the single re-check shared by the ticker and the
	 * completed-phase message_update path (timestamp guard runs before the read).
	 */
	const thinkingRevealed = (): boolean => {
		if (Date.now() - thinkingHiddenCheckedAt <= 500) return false;
		thinkingHiddenCheckedAt = Date.now();
		return !thinkingHidden();
	};

	// (Re-)install the working indicator: new session or reload. Preserves
	// streaming state so a mid-stream reload does not drop the row.
	const installIndicator = async (ctx: ExtensionContext): Promise<void> => {
		workingController?.dispose();
		workingController = undefined;
		try {
			const controller = await installWorkingIndicator(ctx.ui, workingSettings);
			workingController = controller;
			if (workingStreaming) controller.start();
			// Noop install (disabled/blank) after a previous install → restore pi's loader.
			if (controller.frames.length === 0) ctx.ui.setWorkingVisible?.(true);
		} catch (error: unknown) {
			try {
				ctx.ui.setWorkingVisible?.(true);
			} catch {
				// Host without the API — nothing to restore.
			}
			ctx.ui?.notify?.(
				`pi-pretty working indicator failed: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	};

	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.mode === "tui") {
			// Host-written status labels (compacting, retry, summarize, and the plain
			// "Working (… to interrupt)" restored after a reload) bypass pi-pretty's
			// frames and arrive as one flat colour. Route them through the same frame
			// builder so every label in the row animates the same way.
			installGradientLabels({
				settings: workingSettings,
				// Read through ctx, not a captured theme: /theme swaps the object and
				// the palette must follow without a restart.
				getTheme: () => ctx.ui.theme as unknown as WorkingThemeLike,
			});
			installPromptEditor(ctx);
			ctx.ui.setToolsExpanded(false);
			// Per-row hidden-thinking labels: intercept the host's label fan-out so
			// each row keeps its own duration. Falls back to the global-label
			// behavior whenever the host class is missing or reshaped.
			perRowLabels = thinkingSettings.enabled
				? installPerRowThinkingLabels(
						deps?.assistantMessageComponent ??
							(hostSdk as { AssistantMessageComponent?: unknown }).AssistantMessageComponent,
					)
				: undefined;
			await installIndicator(ctx);
		}
	});

	// Drive the working indicator with the streaming lifecycle (the host row is hidden until agent_start).
	pi.on("agent_start", async (_event: unknown, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		workingStreaming = true;
		workingController?.start();
	});
	const stopStreaming = async (_event: unknown, ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") return;
		workingStreaming = false;
		workingController?.stop();
		stopThinkingShimmer();
	};
	pi.on("agent_end", stopStreaming);
	pi.on("agent_settled", stopStreaming);

	const clearThinkingInterval = (): void => {
		if (!thinkingInterval) return;
		clearInterval(thinkingInterval);
		thinkingInterval = undefined;
	};

	const stopThinkingShimmer = (): void => {
		clearThinkingInterval();
		perRowLabels?.clearActive();
		try {
			thinkingTimer?.restore();
		} catch {
			// Teardown must never throw — a host that explodes on restore is left
			// with whatever label it has; the interval is already gone.
		}
		thinkingTimer = undefined;
		thinkingLastMessage = undefined;
	};

	const completeThinkingShimmer = (): void => {
		clearThinkingInterval();
		const ts = messageTimestamp(thinkingLastMessage);
		const frozenMs = thinkingTimer?.complete();
		if (ts !== undefined && frozenMs !== undefined) {
			thinkingElapsedMs.set(ts, frozenMs);
			perRowLabels?.complete(ts, frozenMs);
		}
		// The completed row is no longer the animating one — drop the active mark
		// so subsequent global writes freeze it at its own duration.
		perRowLabels?.clearActive();
		thinkingLastMessage = undefined;
	};

	/** Surface one warning without letting a throwing host escape the crash guard. */
	const notifyThinkingFailure = (ctx: ExtensionContext, error: unknown): void => {
		try {
			ctx.ui?.notify?.(
				`pi-pretty thinking indicator failed: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		} catch {
			// A host that throws on notify too must not crash the timer path.
		}
	};

	// Same 30fps cadence as the working row — but the interval lives ONLY while
	// the streaming message is actively emitting a thinking block (each label
	// change rebuilds chat children, so the moment text or tool calls stream the
	// label freezes as `Thought for {duration}` until the run ends).
	const startThinkingShimmer = (ctx: ExtensionContext): void => {
		if (thinkingInterval || !thinkingSettings.enabled) return;
		try {
			thinkingHiddenCheckedAt = Date.now();
			if (!thinkingHidden()) return; // thinking visible: no label writes at all
			const animator = createThinkingLabelAnimator(ctx.ui, workingSettings, thinkingSettings);
			const activeTs = messageTimestamp(thinkingLastMessage);
			// Same message thinking again (interleaved runs): resume its total.
			const resumeMs = activeTs !== undefined ? (thinkingElapsedMs.get(activeTs) ?? 0) : 0;
			thinkingTimer = createThinkingTimer(animator, Date.now, resumeMs);
			if (activeTs !== undefined) perRowLabels?.setActive(activeTs);
			thinkingTimer.tick();
			thinkingInterval = setInterval(() => {
				try {
					if (!workingStreaming) {
						stopThinkingShimmer();
						return;
					}
					if (thinkingRevealed()) {
						stopThinkingShimmer();
						return;
					}
					if (!thinkingBlockActive(thinkingLastMessage)) {
						// Thinking phase over: freeze its duration until the run ends.
						completeThinkingShimmer();
						return;
					}
					thinkingTimer?.tick();
					// The label has no widget of its own — ask the working indicator to
					// request a host render even when deltas pause mid-thinking.
					workingController?.requestRender();
				} catch (error: unknown) {
					// A throwing host call inside our timer would crash pi (uncaught in
					// setInterval) — tear the label down and surface one warning instead.
					stopThinkingShimmer();
					notifyThinkingFailure(ctx, error);
				}
			}, thinkingSettings.intervalMs ?? WORKING_INTERVAL_MS);
		} catch (error: unknown) {
			stopThinkingShimmer();
			notifyThinkingFailure(ctx, error);
		}
	};

	// Remember the streaming message; lazily start the shimmer on the first
	// thinking delta (thinkingHidden() is re-checked at most every 500ms). After
	// the phase completes, deltas keep refreshing the visibility cache so a
	// mid-run `hideThinkingBlock` toggle-off restores the default label.
	pi.on("message_update", async (event: MessageUpdateEvent, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || !workingStreaming) return;
		thinkingLastMessage = event.message;
		if (thinkingInterval) {
			// Complete immediately on the first text/tool delta instead of waiting
			// for the next animation frame.
			if (!thinkingBlockActive(event.message)) completeThinkingShimmer();
			return;
		}
		if (thinkingBlockActive(event.message)) {
			// First thinking delta — or a later phase after tool calls — starts a
			// fresh timer (the completed one is replaced wholesale).
			startThinkingShimmer(ctx);
			return;
		}
		if (thinkingTimer && thinkingRevealed()) stopThinkingShimmer();
	});

	// The completed wording belongs to the message that produced it. The label
	// is global, so once that assistant message ends, restore pi's default —
	// otherwise every later phase stamps its frozen duration onto every hidden
	// thinking row in the transcript (the image-read " Thought for 5s" stack).
	pi.on("message_end", async (event: MessageEndEvent, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui" || event.message.role !== "assistant") return;
		if (thinkingInterval || thinkingTimer) stopThinkingShimmer();
	});

	pi.on("session_shutdown", async (_event: unknown, ctx?: ExtensionContext) => {
		if (promptEditorInstalled) {
			if (ctx) {
				const editorUi = ctx.ui as unknown as EditorUiCompatibility;
				if (typeof editorUi.setEditorComponent === "function") editorUi.setEditorComponent(previousEditorFactory);
			}
			promptEditorInstalled = false;
			previousEditorFactory = undefined;
		}
		// Tear down the indicator animation; pi re-runs session_start (and our
		// install) after resume or session switching.
		workingController?.dispose();
		workingController = undefined;
		stopThinkingShimmer();
		perRowLabels?.uninstall();
		perRowLabels = undefined;
		thinkingElapsedMs.clear();
		workingStreaming = false;
		uninstallGradientLabels();
	});
}
