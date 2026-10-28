/**
 * Terminal width, clamped so output stays readable on very wide terminals.
 */

export function termWidth(): number {
	if (process.stdout.columns) return Math.max(1, Math.min(process.stdout.columns, 210));
	const raw =
		(process.stderr as NodeJS.WriteStream & { columns?: number }).columns ||
		Number.parseInt(process.env.COLUMNS ?? "", 10) ||
		200;
	return Math.max(1, Math.min(raw - 4, 210));
}
