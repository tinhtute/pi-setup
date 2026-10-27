/**
 * Gradient for labels the host writes into the working row.
 *
 * pi-pretty only animates the row it owns: it hands the host pre-baked frames and
 * sets the host message to "". Every other status — `Compacting context…`,
 * `Retrying (1/3) in 5s…`, `Summarizing branch…`, and the plain
 * `Working (ctrl+c to interrupt)` the host restores after a reload — arrives
 * through `Loader.setMessage()` as one flat colour, because `Loader` only knows
 * "spinner + one messageColorFn".
 *
 * The host's status classes are not exported, so there is no class to wrap. What
 * is exported is `Loader`, and all of them inherit from it. Patching
 * `Loader.prototype.setMessage` therefore catches every label with a single seam:
 * turn the incoming text into frames and let the existing verbatim path render it.
 *
 * One seam is not enough. `StatusIndicator`'s subclasses pass their *first* label
 * to the `Loader` constructor, which assigns the field directly and never calls
 * `setMessage` — so `Compacting context...`, `Auto-compacting...`,
 * `Summarizing branch...`, and the first `Retrying (n/m)` frame arrived flat while
 * every later update shimmered. `Loader.prototype.start` is the moment that first
 * label becomes visible, so the same conversion runs there, for every Loader: pi's
 * status row, the chat's bash `Running...` row, `BorderedLoader` dialogs, and any
 * extension loader built on `Loader` (pi-tui-kit's `TaskLoader`). They all compose
 * the Loader as a child and render it, so replacing the message with frames only
 * moves the text, never drops it.
 *
 * An empty message is left alone — that is pi-pretty's own managed row, whose
 * text already lives inside its frames.
 */

import { Loader } from "@earendil-works/pi-tui";
import { buildWorkingFrames, WORKING_INTERVAL_MS } from "./frames.js";
import { resolvePaletteAnsi } from "./palette.js";
import type { WorkingIndicatorSettings } from "./settings.js";
import { resolveStops } from "./theme-stops.js";
import type { WorkingThemeLike } from "./types.js";

/** Holds the install options; set on the prototype by {@link installGradientLabels}. */
const OPTIONS = Symbol.for("pi-pretty.gradient.options");
/** Marks a Loader whose setMessage we already replaced. */
const PATCHED = Symbol.for("pi-pretty.gradient.patched");
/** Per-instance: the label the current frame set was built from. */
const LABEL = Symbol.for("pi-pretty.gradient.label");
/** Kept so tests (and a future uninstall) can restore the host method. */
const ORIGINAL = Symbol.for("pi-pretty.gradient.original");
/** Same, for the `start` seam that catches constructor-set labels. */
const START_ORIGINAL = Symbol.for("pi-pretty.gradient.start.original");
/** Set while a constructor label is being converted, so the re-entrant
 *  `setIndicator` → `start` hop does not convert the same label again. */
const CONVERTING = Symbol.for("pi-pretty.gradient.converting");

type LoaderProto = {
	setMessage(message: string): void;
	start(): void;
	[PATCHED]?: boolean;
	[OPTIONS]?: GradientLabelOptions;
	[ORIGINAL]?: (message: string) => void;
	[START_ORIGINAL]?: () => void;
};

type LoaderInstance = {
	frames: string[];
	renderIndicatorVerbatim: boolean;
	message: string;
	setIndicator(indicator?: { frames?: string[]; intervalMs?: number }): void;
	[LABEL]?: string;
	[CONVERTING]?: boolean;
};

export interface GradientLabelOptions {
	settings: WorkingIndicatorSettings;
	/** Read at call time: the theme object changes on /theme. */
	getTheme(): WorkingThemeLike | undefined;
}

/** Frames built per label, so the 30fps tick never rebuilds them. */
const frameCache = new Map<string, { frames: string[]; intervalMs: number }>();

/**
 * Cache key: the label plus everything the frames are painted from. The label
 * alone is not enough — a `/theme` swap or a re-install with different settings
 * keeps the same text and would otherwise be served stale colours forever.
 */
function cacheKey(
	text: string,
	settings: WorkingIndicatorSettings,
	stops: readonly string[] | undefined,
	theme: WorkingThemeLike | undefined,
): string {
	const palette = resolvePaletteAnsi(settings.palette, theme);
	return [
		text,
		settings.mode,
		stops?.join("|") ?? "",
		settings.bold ? "b" : "-",
		settings.intervalMs ?? WORKING_INTERVAL_MS,
		palette.low,
		palette.mid,
		palette.high,
	].join("\u0001");
}

function buildForLabel(
	text: string,
	settings: WorkingIndicatorSettings,
	theme: WorkingThemeLike | undefined,
): { frames: string[]; intervalMs: number } | undefined {
	const stops = resolveStops(settings.stops, theme);
	const key = cacheKey(text, settings, stops, theme);
	const cached = frameCache.get(key);
	if (cached) return cached;

	const { frames, intervalMs } = buildWorkingFrames([text], {
		mode: settings.mode,
		ansi: resolvePaletteAnsi(settings.palette, theme),
		stops,
		bold: settings.bold,
		// The host's own glyph never reaches the screen: the frames are verbatim, so
		// whatever spinner it drew is replaced. Dropping the glyph here would make the
		// compacting/retry row one column narrower than the Working row it replaces,
		// so keep it and tint it with the resting colour.
		spinner: true,
		intervalMs: settings.intervalMs ?? WORKING_INTERVAL_MS,
	});
	if (frames.length === 0) return undefined;

	const built = { frames, intervalMs };
	// Labels are short and few; cap so a pathological host loop cannot grow this.
	if (frameCache.size > 64) frameCache.clear();
	frameCache.set(key, built);
	return built;
}

/**
 * Route every non-empty host label through the shimmer frame builder.
 * Idempotent, and re-installing updates the settings the next label will use.
 */
export function installGradientLabels(options: GradientLabelOptions): void {
	const proto = Loader.prototype as unknown as LoaderProto;

	if (proto[PATCHED]) {
		// A later session gets fresh settings/theme getters.
		proto[OPTIONS] = options;
		return;
	}

	const original = proto.setMessage;
	proto[ORIGINAL] = original;

	proto.setMessage = function patchedSetMessage(this: LoaderInstance, message: string): void {
		const live = proto[OPTIONS];

		// Empty message: pi-pretty's own row, text already inside the frames.
		if (!live || message.trim() === "") {
			original.call(this, message);
			return;
		}

		// Already built for this exact label — skip the rebuild, keep animating.
		if (this[LABEL] === message && this.renderIndicatorVerbatim) {
			original.call(this, "");
			return;
		}

		const built = buildForLabel(message, live.settings, live.getTheme());
		if (!built) {
			// Nothing to animate (e.g. blank text): show it flat.
			this[LABEL] = undefined;
			original.call(this, message);
			return;
		}

		// setIndicator is the public seam: it swaps the frames, adopts our interval,
		// marks the frames verbatim, and restarts the timer at that interval. Writing
		// the private fields directly would leave restartAnimation on the old cadence.
		this.setIndicator({ frames: built.frames, intervalMs: built.intervalMs });
		this[LABEL] = message;
		// The text now lives in the frames; the host must not paint it again.
		original.call(this, "");
	};

	const originalStart = proto.start;
	proto[START_ORIGINAL] = originalStart;
	proto.start = function patchedStart(this: LoaderInstance): void {
		const live = proto[OPTIONS];
		// A label handed to the constructor is already on the instance here, and it is
		// about to be drawn for the first time. Route it through the seam above so the
		// first frame shimmers too. Converting calls `setIndicator`, which starts us
		// again before the message has been cleared, so the flag stops that hop from
		// re-converting the same label.
		if (live && !this[CONVERTING] && typeof this.message === "string" && this.message.trim() !== "") {
			this[CONVERTING] = true;
			try {
				proto.setMessage.call(this, this.message);
			} finally {
				this[CONVERTING] = false;
			}
		}
		originalStart.call(this);
	};

	proto[PATCHED] = true;
	proto[OPTIONS] = options;
}

/** Restore the host method and drop cached frames. Used by tests and session teardown. */
export function uninstallGradientLabels(): void {
	const proto = Loader.prototype as unknown as LoaderProto;
	const original = proto[ORIGINAL];
	const originalStart = proto[START_ORIGINAL];
	if (proto[PATCHED] && original) proto.setMessage = original;
	if (proto[PATCHED] && originalStart) proto.start = originalStart;
	delete proto[PATCHED];
	delete proto[OPTIONS];
	delete proto[ORIGINAL];
	delete proto[START_ORIGINAL];
	frameCache.clear();
}
