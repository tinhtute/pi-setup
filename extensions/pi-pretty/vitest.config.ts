import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// The suite exercises the extension with the config directory it would find on a real
// machine. Without an override, `loadConfig()` reads ~/.pi/agent/pi-pretty.json, so the
// operator's own theme, icons, and tool sets leak into assertions. Point it at an empty
// directory instead so the suite tests the code, not this laptop.
const isolatedConfigDir = mkdtempSync(join(tmpdir(), "pi-pretty-test-cfg-"));

export default defineConfig({
	test: {
		env: {
			PRETTY_CONFIG_DIR: isolatedConfigDir,
			// Keep colour output stable and independent of the terminal that ran the tests.
			NO_COLOR: "",
			FORCE_COLOR: "1",
		},
	},
});
