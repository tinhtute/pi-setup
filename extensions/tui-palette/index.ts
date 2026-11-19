// Entry point that exists so `setup/install.sh` ships this directory.
//
// `install.sh` copies every `extensions/*/` that holds an `index.ts` or a `package.json`,
// which is how a multi-file extension reaches `~/.pi/agent/extensions/`. This one is not an
// extension: `palette.ts` is a library that `custom-footer.ts` and `confirm-guard/box.ts`
// import. Pi loads this module and it registers nothing, which is the whole point.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function tuiPalette(_pi: ExtensionAPI): void {
	// Intentionally empty. See the comment above.
}
