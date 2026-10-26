// Run from the repo root: node tests/test-git-hooks.mjs
//
// The pre-push hook is shell, so it is tested by feeding it the stdin protocol
// git uses and reading the exit code:
//
//   <local ref> SP <local sha> SP <remote ref> SP <remote sha> LF
//
// The point of the policy change: a plain push to main must pass, and only a
// history rewrite (or a deletion) may be refused. A hook that blocks everything
// would pass a test that only asserts the refusal cases, so both halves are here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOOK = resolve("setup/git-hooks/pre-push");

let failures = 0;
function test(name, fn) {
	try {
		fn();
		console.log(`  ok   ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`  FAIL ${name}\n       ${error.message}`);
	}
}

const ZERO = "0000000000000000000000000000000000000000";

/**
 * Run the hook with one ref update on stdin.
 * Returns { status, stderr } instead of throwing, so refusals are data.
 */
function push({ localRef = "refs/heads/main", localSha, remoteRef = "refs/heads/main", remoteSha }) {
	try {
		execFileSync("sh", [HOOK], {
			input: `${localRef} ${localSha} ${remoteRef} ${remoteSha}\n`,
			encoding: "utf8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { status: 0, stderr: "" };
	} catch (error) {
		return { status: error.status ?? 1, stderr: `${error.stderr ?? ""}` };
	}
}

// The hook resolves ancestry with real git objects, so the fixtures are the
// repo's own commits: an ancestor and its descendant cannot be faked.
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const parent = execFileSync("git", ["rev-parse", "HEAD~1"], { encoding: "utf8" }).trim();

console.log("pre-push");

test("allows a plain push to main (the policy: PR or direct push)", () => {
	// Remote is at the parent, local adds one commit on top: a fast-forward.
	const result = push({ localSha: head, remoteSha: parent });
	assert.equal(result.status, 0, `expected allow, got refusal:\n${result.stderr}`);
});

test("allows a push to main that already matches the remote", () => {
	assert.equal(push({ localSha: head, remoteSha: head }).status, 0);
});

test("allows the first push to an empty main", () => {
	assert.equal(push({ localSha: head, remoteSha: ZERO }).status, 0);
});

test("allows a fast-forward that catches up several commits", () => {
	const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { encoding: "utf8" }).trim();
	const result = push({ localSha: head, remoteSha: root });
	assert.equal(result.status, 0, `expected allow, got refusal:\n${result.stderr}`);
});

test("refuses to rewrite main (remote has a commit the local branch lacks)", () => {
	// Local at the parent, remote at HEAD: pushing would drop HEAD from the remote.
	const result = push({ localSha: parent, remoteSha: head });
	assert.equal(result.status, 1, "expected a refusal");
	assert.match(result.stderr, /non-fast-forward/);
	assert.match(result.stderr, /pull --rebase/);
});

test("refuses to delete main", () => {
	const result = push({ localSha: ZERO, remoteSha: head });
	assert.equal(result.status, 1, "expected a refusal");
	assert.match(result.stderr, /refusing to delete/);
});

test("ignores other branches entirely", () => {
	const result = push({ localRef: "refs/heads/feat/x", remoteRef: "refs/heads/feat/x", localSha: parent, remoteSha: head });
	assert.equal(result.status, 0, "a feature branch may be force-pushed");
});

test("ignores tags", () => {
	const result = push({ localRef: "refs/tags/v1", remoteRef: "refs/tags/v1", localSha: parent, remoteSha: head });
	assert.equal(result.status, 0);
});

test("is executable and parses under sh", () => {
	const mode = execFileSync("git", ["ls-files", "-s", "setup/git-hooks/pre-push"], { encoding: "utf8" });
	assert.match(mode, /^100755/, "hook must be tracked as executable");
	const source = readFileSync(HOOK, "utf8");
	assert.match(source, /^#!\/bin\/sh/, "hook must declare an sh shebang");
	execFileSync("sh", ["-n", HOOK]);
});

if (failures) {
	console.error(`\n${failures} assertion(s) failed`);
	process.exit(1);
}
console.log("PASS");
