# Multi-machine continuity

Working note. The question this answers: *I am coding with Pi on this Ubuntu box.
Can I open my MacBook later and continue the same work?*

Short answer: yes, but not by installing something. Three state layers are
involved, they are stored differently, and each option below moves only one of
them. Getting this wrong is how people end up with two half-finished branches and
a session file they cannot resume.

Checked 2026-10-29 against `@earendil-works/pi-coding-agent@1.4.0` (docs in the
installed package) and `@earendil-works/pi-durable@1.4.0`.

## The three layers

| Layer | Pi coding agent (local) | Pi Durable (anywhere) |
| --- | --- | --- |
| Transcript / session | `~/.pi/agent/sessions/--<cwd>--/<timestamp>_<id>.jsonl`, one file per session, on the machine | In the storage backend (a Durable Object's SQLite, or your own); every client sees it |
| Code, git, shell | The checkout on that machine | A workspace in the execution environment you supply — the DO's `@cloudflare/computer` workspace, a remote box, or the same local checkout |
| UI | The `pi` TUI in a terminal | Whatever app you build over snapshot + event stream |

Pi Durable owns layer 1 by construction. For layer 2 it supplies the mechanism —
an execution environment built per tool call — but where that environment points
is a decision you make. Most of the confusion around "durable coding" comes from
expecting the package to make it for you.

## Layer 1 facts, from the 1.4.0 docs

Sessions are JSONL, entries form a tree via `id`/`parentId`, and the file lives at:

```text
~/.pi/agent/sessions/--<path>--/<timestamp>_<session-id>.jsonl
```

`<path>` is the working directory with the leading separator removed and `/`,
`\`, `:` replaced by `-`. So the folder name **encodes the absolute cwd**.

Relevant commands and settings:

| Knob | Effect |
| --- | --- |
| `pi --continue` | Most recent session for the current cwd (matches on the header cwd, so another home directory finds nothing) (unverified) |
| `pi --resume`, `/resume` | Session picker (search, rename, delete, show paths) |
| `pi --session <path\|id>` | Open a specific session file |
| `pi --session-dir`, `PI_CODING_AGENT_SESSION_DIR`, `sessionDir` | Store sessions somewhere else (CLI flag wins) |
| `/tree`, `/fork`, `/clone` | Branch in place, branch into a new file, copy into a new file |
| `/export <path>` | Writes HTML, or a real JSONL session file that `/import <path>` resumes |
| `/share` | Uploads to a gist or Radius and returns a viewer link — not resumable |
| `pi --no-session` | Ephemeral, cannot be resumed |
| `/session` | Show the current file, id, message count, tokens, cost |

Authentication is separate: `~/.pi/agent/auth.json` per machine. Copying sessions
does not copy logins.

## Three options

### A. One always-on machine, two terminals (recommended)

Run Pi on a host that stays up — the Ubuntu box, a VM, whatever you already own —
and attach from both laptops over SSH inside tmux. The repo, the session, the
tools and the git state all stay in one place. Nothing to sync, nothing to
reconcile, both machines are just terminals.

```bash
ssh dev-box
tmux new -A -s pi     # attach or create
cd ~/Lab/project && pi --continue
```

Trade-offs: needs a reachable host (Tailscale removes the NAT problem), and the
laptop is useless offline. `docs/tmux.md` in the Pi package covers the
extended-key config Pi needs inside tmux (CSI-u on tmux 3.5+, which is what makes
`Shift+Enter`/`Enter` distinguishable).

This is the cheapest correct answer, and it is not a Pi Durable story at all.

### B. Sync the session files and the repo

Keep working locally on both machines, and sync `~/.pi/agent/sessions/` plus the
checkout (Syncthing, iCloud, or the repo itself in git). Then `pi --resume` on the
other side.

Four traps, in the order they bite:

1. **The cwd is baked into the folder name.** `/home/tinhpt/Lab/x` on Ubuntu and
   `/Users/tinhpt/Lab/x` on macOS are different buckets. `--continue` then finds
   nothing, and `/resume` opens scoped to *Current Folder* — Tab switches the
   scope to *All* (unverified), which lists every bucket and opens the session. A shared
   `--session-dir` or `PI_CODING_AGENT_SESSION_DIR` narrows the search but the
   picker still prefers the header cwd, so expect to use *All*; `pi --session
   <path>` avoids the question entirely.
2. **No locking.** Pi writes its session file as a plain append; running both
   machines at once on one synced file invites a conflict copy or a lost branch.
   One machine at a time, and let the sync settle before switching.
3. **Auth does not travel.** Log in again on the Mac.
4. **Only the JSONL export is a handoff.** `/export x.jsonl` writes a genuine
   session file — one branch, `parentId` chain rewritten (unverified) — that `/import x.jsonl`
   resumes. It lands outside any `--<cwd>--` bucket, so open it by path; `/export`
   to HTML is the readable artifact, not a handoff.

Fine for occasional switches when you have no always-on host; it is manual and it
breaks quietly the first time you forget trap 1.

### C. Pi Durable with the repo on one host

The durable version of option A: run the harness where it can keep running (a
Durable Object, a VPS, a container), and give it an execution environment that
points at the machine holding the checkout. Pi Durable builds the environment per
tool call from the conversation's cwd, and it explicitly supports "harness on one
machine, tools on another".

What you gain over A: the agent keeps working while every laptop is closed,
sessions survive the host dying, multiple people can steer the same conversation,
scheduled work wakes itself, and the UI stops being a terminal.

What it costs:

- You write the UI. No shipped coding-agent TUI runs on Pi Durable: the
  announcement's demos include a small coding agent and a vacation planner that
  borrow the coding agent's TUI components, but the samples you would start from
  are a multiplayer chat and a chat app with a workspace.
- If the execution environment is the Durable Object workspace, the code lives in
  Cloudflare, not in your repo, and you are pushing/pulling with git from inside
  the workspace. If you want your own host to stay the source of truth, you
  implement the remote environment.
- No built-in approval for tool calls (a [`beforeTool` hook plus `api.memo`](https://earendil.com/posts/pi-durable/)
  can provide one), and a single model request that
  streams longer than 15 minutes can be cut off by the alarm boundary. See
  [pi-durable-cloudflare.md](pi-durable-cloudflare.md#limits-cloudflare-documents).

Correct when the requirement is "the agent works while I am away". Not correct as
a cheaper way to switch editors.

## Verdict

- Switching machines to *type into the same session*: option A. It is one SSH
  command and it does not depend on either research note above.
- No always-on host available: option B, with a shared `--session-dir` and one
  machine at a time.
- The agent must keep working, or several people must steer it: option C, and
  keep the checkout on one host behind a remote execution environment rather than
  inside the Durable Object.

The distinction to keep: **durable execution is about surviving process death.
Switching clients is about where the state and the checkout live.** Pi Durable
gives you the first for free and the second only if you place the execution
environment deliberately.

## Sources

- Pi docs, `docs/sessions.md`, `docs/session-format.md`, `docs/slash-commands.md`
  (`/import`, `/export`, `/share`), `docs/configuration.md` (agent directory,
  `auth.json`) and `docs/tmux.md`, all in `@earendil-works/pi-coding-agent@1.4.0`
  (installed locally); `/share` targets and the *Current Folder* resume scope
  checked in the package's `dist` source
- Pi Durable announcement, execution environments and remote tools —
  <https://earendil.com/posts/pi-durable/>
- Cloudflare Agents docs, Pi harness (recovery, alarm limits) —
  <https://developers.cloudflare.com/agents/harnesses/pi/>
- Earendil, "Pi Durable on Cloudflare" (one DO per session, wake mapping) —
  <https://earendil.com/posts/pi-durable-on-cloudflare/>
