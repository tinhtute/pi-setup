/**
 * Installing the indicator on a host.
 *
 * Two paths: Pi's embedded working-status API renders the frames inside the
 * editor's top border, and older hosts get the widget fallback.
 */

import { dimAccentHex, hexToAnsiFg, sessionAccentHex } from "../session-color.js";
import { buildWorkingFrames } from "./frames.js";
import { resolvePaletteAnsi } from "./palette.js";
import { resolveStops } from "./theme-stops.js";
import type { WorkingIndicatorSettings } from "./settings.js";
import type { WidgetTuiLike, WorkingThemeLike } from "./types.js";
import { WorkingWidget } from "./widget.js";

// ─── Installation ────────────────────────────────────────────────────────────

export interface WorkingStatusOptionsLike {
	frames?: string[];
	intervalMs?: number;
}

export interface WorkingUiLike {
	theme?: WorkingThemeLike;
	/** Hosts with Pi's embedded working-status API render this in the editor border. */
	setWorkingIndicator?: (options?: WorkingStatusOptionsLike) => void;
	/** Clear the host message appended after a custom native frame. */
	setWorkingMessage?: (message?: string) => void;
	setWorkingVisible(visible: boolean): void;
	setWidget(
		key: string,
		factory: ((tui: WidgetTuiLike, theme: unknown) => WorkingWidget) | undefined,
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
}

/** @deprecated Retained for compatibility with the former hint-resolution seam. */
export interface KeybindingsLike {
	getKeys(name: string): string[];
}

export interface WorkingIndicatorController {
	/** Streaming began — show and animate the row. */
	start(): void;
	/** Streaming ended — hide the row and pause the animation. */
	stop(): void;
	/** Remove the indicator and stop the animation. */
	dispose(): void;
	/** @deprecated Token stats are owned by Pi and are no longer rendered here. */
	setStats(text: string | undefined): void;
	/** Request a host render for consumers that drive another animated label. */
	requestRender(): void;
	/** Pre-rendered frames (exposed for diagnostics). */
	readonly frames: readonly string[];
}

const WIDGET_KEY = "pi-pretty-working";

/**
 * Install the custom working shimmer and return its lifecycle controller.
 *
 * Current Pi hosts receive the pre-rendered frames through the embedded
 * working-status API, which places them in the editor's top border. Older
 * hosts use a zero-padding widget above the editor. The host lifecycle drives
 * the controller (`start` on agent_start, `stop` on agent_end); disabled or
 * empty phrase settings leave host defaults untouched.
 */
export async function installWorkingIndicator(
	ui: WorkingUiLike,
	settings: WorkingIndicatorSettings,
	deps?: { getKeybindings?: () => KeybindingsLike | undefined | Promise<KeybindingsLike | undefined> },
	sessionName?: string,
): Promise<WorkingIndicatorController> {
	const noopController: WorkingIndicatorController = {
		start() {},
		stop() {},
		dispose() {},
		setStats() {},
		requestRender() {},
		frames: [],
	};
	if (!settings.enabled) return noopController;
	const texts = settings.texts.map((t) => t.trim()).filter((t) => t.length > 0);
	if (texts.length === 0) return noopController;
	void deps; // Retained for compatibility; interrupt hints are no longer resolved here.

	const ansiResolved = resolvePaletteAnsi(settings.palette, ui.theme);
	let ansi = ansiResolved;
	let spinnerColor: string | undefined;
	if (settings.sessionAccent && sessionName && !settings.tiersCustomized && !settings.stops) {
		const accentHex = sessionAccentHex(sessionName);
		const accent = hexToAnsiFg(accentHex);
		if (accent) {
			ansi = { ...ansi, mid: accent, high: accent };
			spinnerColor = hexToAnsiFg(dimAccentHex(accentHex));
		}
	}
	const { frames, intervalMs } = buildWorkingFrames(texts, {
		mode: settings.mode,
		ansi,
		stops: resolveStops(settings.stops, ui.theme),
		bold: settings.bold,
		spinnerColor,
		intervalMs: settings.intervalMs,
	});
	if (frames.length === 0) return noopController;

	const setWorkingIndicator = ui.setWorkingIndicator;
	const setWorkingMessage = ui.setWorkingMessage;
	if (typeof setWorkingIndicator === "function" && typeof setWorkingMessage === "function") {
		let started = false;
		let disposed = false;
		const updateNativeMessage = (): void => {
			// Keep Pi's built-in message hidden because the custom frame already
			// supplies the working label; no hint or token suffix is added here.
			setWorkingMessage.call(ui, "");
		};

		try {
			setWorkingIndicator.call(ui, { frames, intervalMs });
			// Keep the native status row hidden until the extension lifecycle starts it.
			// An empty message is intentional: all visible content lives in our frames.
			updateNativeMessage();
			ui.setWorkingVisible(false);
		} catch (error: unknown) {
			try {
				setWorkingIndicator.call(ui);
				setWorkingMessage.call(ui);
			} catch {
				// Best-effort rollback; the caller still restores host visibility.
			}
			throw error;
		}
		return {
			start: () => {
				if (disposed || started) return;
				started = true;
				updateNativeMessage();
				ui.setWorkingVisible(true);
			},
			stop: () => {
				if (!started) return;
				started = false;
				ui.setWorkingVisible(false);
			},
			dispose: () => {
				if (disposed) return;
				if (started) {
					started = false;
					ui.setWorkingVisible(false);
				}
				disposed = true;
				setWorkingIndicator.call(ui);
				setWorkingMessage.call(ui);
			},
			setStats: (_text: string | undefined) => {},
			requestRender: () => updateNativeMessage(),
			frames,
		};
	}

	const widget = new WorkingWidget();
	widget.setFrames(frames, intervalMs);
	// Widget first, visibility second: if setWidget throws (older host without
	// the native working-status API) the host loader was never hidden and pi's
	// default remains.
	ui.setWidget(
		WIDGET_KEY,
		(tui) => {
			widget.attach(tui);
			return widget;
		},
		{ placement: "aboveEditor" },
	);
	ui.setWorkingVisible(false);
	return {
		start: () => widget.start(),
		stop: () => widget.stop(),
		dispose: () => {
			widget.dispose();
			ui.setWidget(WIDGET_KEY, undefined);
		},
		setStats: (_text: string | undefined) => {},
		requestRender: () => widget.requestRender(),
		frames,
	};
}
