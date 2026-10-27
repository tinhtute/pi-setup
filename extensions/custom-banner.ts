import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { mixColors, parseColor, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { VERSION } from "@earendil-works/pi-coding-agent";

const BANNER = [
	"░▀█▀░█░█▄░█░█▄█░▀█▀░█▒█░▀█▀▒██▀░░",
	"░▒█▒░█░█▒▀█▒█▒█░▒█▒░▀▄█░▒█▒░█▄▄▒░",
];

/**
 * The header's own rainbow, fixed on purpose: the ASCII art is a signature, not a
 * status surface, so it stays cyan → orange whatever the theme is. The working row
 * is the theme-following surface — see `extensions/pi-pretty/` (`workingIndicator.stops`).
 */
const PALETTE = ["#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb923c"].map(parseColor);

function gradient(text: string, theme: Theme): string {
	const chars = Array.from(text);
	return chars.map((char, index) => {
		const position = (index / Math.max(1, chars.length - 1)) * (PALETTE.length - 1);
		const stop = Math.min(Math.floor(position), PALETTE.length - 2);
		const color = mixColors(PALETTE[stop], PALETTE[stop + 1], position - stop, "srgb");
		return theme.style(char, { fg: color, bold: true });
	}).join("");
}

function center(text: string, width: number): string {
	const fitted = truncateToWidth(text, Math.max(0, width));
	const pad = Math.max(0, Math.floor((width - visibleWidth(fitted)) / 2));
	return " ".repeat(pad) + fitted;
}

class CustomBannerHeader {
	private expanded = false;
	private theme: Theme;

	constructor(theme: Theme) {
		this.theme = theme;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const lines: string[] = [""];
		const t = this.theme;

		if (width >= Math.max(...BANNER.map(visibleWidth))) {
			for (const line of BANNER) {
				lines.push(center(gradient(line, t), width));
			}
		} else {
			lines.push(center(gradient("◆ TINHTUTE ◆", t), width));
		}

		lines.push("");
		const subtitle = `${t.bold(t.fg("accent", "pi"))} ${t.fg("dim", `v${VERSION ?? "0.85.1"}`)} · ${t.fg("muted", "minimal coding agent")}`;
		lines.push(center(subtitle, width));

		if (this.expanded) {
			lines.push("");
			lines.push(center(t.bold("Keyboard Shortcuts"), width));
			lines.push("");
			const shortcuts = [
				["Ctrl+C", "Interrupt / Clear"],
				["Ctrl+D", "Exit (when editor is empty)"],
				["Ctrl+O", "Toggle expand header & tools"],
				["Ctrl+T", "Cycle thinking level"],
				["Ctrl+P / Shift+P", "Cycle models forward / backward"],
				["Ctrl+M", "Select model dialog"],
				["Ctrl+G", "Open in external editor"],
				["/", "Slash commands menu"],
				["!", "Run bash command in terminal"],
				["Alt+Enter", "Queue follow-up message"],
				["Ctrl+V", "Paste image from clipboard"],
			];
			for (const [key, desc] of shortcuts) {
				const item = `  ${t.fg("accent", key.padEnd(18))} ${t.fg("muted", desc)}`;
				lines.push(width > 50 ? center(item, width) : item);
			}
		} else {
			const hints = `${t.fg("dim", "Ctrl+C interrupt · / commands · ! bash · Ctrl+O more")}`;
			lines.push(center(hints, width));
		}

		lines.push("");
		return lines.map((line) => truncateToWidth(line, Math.max(0, width)));
	}
}

export default function (pi: ExtensionAPI) {
	const applyHeader = (ctx: ExtensionContext) => {
		if (ctx.mode === "tui") {
			ctx.ui.setHeader((_tui, theme) => new CustomBannerHeader(theme));
		}
	};

	pi.on("session_start", async (_event, ctx) => {
		applyHeader(ctx);
	});

	pi.registerCommand("builtin-header", {
		description: "Restore built-in default Pi header",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});

	pi.registerCommand("custom-header", {
		description: "Show custom TINHTUTE banner header",
		handler: async (_args, ctx) => {
			applyHeader(ctx);
			ctx.ui.notify("Custom TINHTUTE banner restored", "info");
		},
	});
}
