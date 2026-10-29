# Pi Durable

Working note. What `@earendil-works/pi-durable` is, how its durability actually
works, and what it does not do. Notes only — nothing here is installed by
`setup/install.sh`, and Pi Durable does not replace the Pi coding agent.

Checked against `@earendil-works/pi-durable@1.4.0` on 2026-10-29, the same
minor as the `@earendil-works/pi-coding-agent@1.4.0` this repo configures.

## What it is

A durable agent harness: a library for building agent applications that outlive
the process running them. Conversations, model turns, tool calls and application
state are committed to storage **before** anything is shown. If the process
dies, a new process opens the same storage and continues from the last
checkpoint.

It shipped with Pi 1.0 on 2026-10-01 as an experimental package (MIT). The
positioning in the announcement is explicit: it does not replace the coding
agent, which stays a terminal TUI driven by one person on one machine; Pi Durable
is the framework you build agentic applications with, coding agents included. It
shares `pi-ai` (model access) and `@earendil-works/chord` (documents,
cancellation, telemetry context) with the coding agent.

The API changes between releases. Treat any code in these notes as a sketch.

## Core model

| Concept | What it is |
| --- | --- |
| Harness | One open storage plus the machinery that runs agents on it. `Harness.open(storage, { models, registry, env }, context)` |
| Conversation | A transcript of immutable entries. `root()` creates it on first use; `fork(entryId)` shares history without copying |
| Entry | One record: `pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.reset`, or your own kind |
| Commit | One atomic write. `conversation.commit((tx) => ...)` appends entries, edits documents and creates tasks together — all or nothing |
| Document | Typed JSON state stored beside the transcript and changed in the same commits, so it cannot disagree with it (`defineDoc`) |
| Task | A durable state machine with a checkpoint per step, phases, timers that survive restarts, and an owner |
| Submission | Input handed to a conversation (`submit`), with a `requestId` for exactly-once, and `wait()` for the settlement |
| Extension | Named bundle of prompt sections, tools, hooks, wraps and tasks |
| Registry | The extensions this process installed. Mutable while the harness runs |
| Agent | Per-conversation model, thinking level, extensions, tools, instructions and cwd — stored as names, resolved on use |

Two vocabulary notes, because the same thing has three names across the stack:
Pi Durable says *conversation*, the Cloudflare `PiHarness` wrapper says *session*
(root id `"1"`), and some newer vendor docs say *lane*. See
[pi-durable-cloudflare.md](pi-durable-cloudflare.md#vocabulary).

## Durability semantics

These are the behaviours that matter, and they are what make the design
different from "write a JSON file at the end of the turn":

- Model request cut off mid-stream: the partial answer stays in the transcript,
  marked aborted, and the request is sent again.
- Tool cut off: it reruns **only** if it declares `replay: "safe"`. Otherwise the
  model is told the call was interrupted, with the output stored so far, and
  decides what to do.
- `requestId` on a submission makes it exactly-once: a client that retries after
  a crash gets the original submission back instead of asking twice.
- Aborts cascade bottom-up through the ownership tree. Each task cleans up its
  own effects in `abort` — the canonical example is refunding a payment whose
  sibling failed (`policy: "failFast"`).
- Tasks are foreground by default (the conversation is idle only when they
  finish) or background (`background: true`, survives the Esc that aborts the
  turn).
- Hooks can run again after a crash, so a hook that makes a decision stores it in
  a memo (`api.memo`), where the first write wins.
- Sleep deadlines are stored on an injected clock, so every process that opens
  one storage must use the same clock. With `onWake`, the harness arms no timer
  for sleeps at all; it tells the host what `harness.wake()` says and the host
  keeps the alarm. (The Node environment, file watcher and image worker still
  keep their own timers.)

## Storage

| Backend | Import | Notes |
| --- | --- | --- |
| Memory | `MemoryStorage` | Nothing persisted |
| IndexedDB | `IndexedDbStorage.open(name)` | Browser. One owner at a time — wrap in a Web Lock rather than opening it in two tabs |
| SQLite | `openNodeSqliteStorage(path)` | One file, WAL, `synchronous = NORMAL`: commits survive process crashes, the newest may be lost on power or host failure |
| JSONL | `openNodeJsonlStorage(dir, context)` | Append-only, `{ fsync: true }` to flush before each commit marker. Keeps the whole history in memory too — use SQLite for long runs |
| Cloudflare Durable Object | `openDurableObjectSqliteStorage(ctx.storage)` | The DO's SQLite; Pi commits are storage transactions |

- Only the working set stays in memory: active transcripts, live tasks, pending
  submissions. Compaction bounds an active transcript, so a conversation of tens
  of thousands of messages still fits.
- **One process owns a storage at a time.** There is no cross-process locking.
  Other clients attach to the process that owns it.
- The interface is small enough to reimplement on a key-value store or Postgres,
  and the package ships a conformance suite for checking a backend.
- SQLite can namespace its tables (`{ prefix: "pi_" }`) so it can share a
  database with someone else's schema. Changing the prefix does not migrate
  existing data.
- The portable SQLite and JSONL cores use no Node APIs, so they run on Bun or in
  a Durable Object given a small adapter.

## Execution environments

Tools that need files or a shell get them from an execution environment. The
package ships a Node environment (`NodeExecutionEnv({ cwd })`); the interface is
small, so a remote one is possible. The `env` function builds the environment per
tool call from the conversation's cwd, which means **the harness can run on one
machine while its tools run on another**, and each conversation can run in a
different place. That is the property worth remembering when thinking about
which machine the code lives on — see
[multi-machine-continuity.md](multi-machine-continuity.md).

## Compaction and reset

Compaction is a task like any other: a background summary starts at
`backgroundTokens` before the limit, the conversation only waits at
`reserveTokens`, and the summary lands at the next turn boundary. If a provider
still rejects a request as too long, the harness compacts and retries once. Older
messages always stay in storage.

`reset(handoff)` starts a new context from a handoff note, and a tool can request
the same by returning `control: { handoff }`. Nothing is deleted, so a second
tool can still search the whole history — the basis for agents that hand off to
themselves and look things up later.

## Multiplayer and UI

Everything a UI needs is committed state, so any number of clients can attach to
any conversation: a snapshot first, then only what changes. `watch()` delivers the
exact operations of each commit (small, socket-friendly); `watchEvents()` turns
them into the coding agent's familiar events at the cost of more bytes.
`submit(..., { whenBusy: "steer" })` joins the running work after the current
tool round; the default queues a follow-up as its own run.

## Size and examples

About 15,000 lines of source without tests (~150k tokens for GPT, ~250k for
Claude); the storage backends alone are about 3,000 lines that a typical
integration never needs to read. The announcement ships two demos: a small coding
agent and a vacation planner (~1,300 lines of TypeScript, mostly TUI).
Thirty-plus worked examples live in `packages/durable/test/examples` in the Pi
repository.

## Limits

Pi Durable itself:

- Experimental; the API moves between releases.
- No built-in approval or permission step for tool calls; build one with a
  [`beforeTool` hook plus `api.memo`](https://earendil.com/posts/pi-durable/).
- No event replay: a stream always starts from a snapshot.
- `abort()` waits until the conversation is idle; a tool that ignores its signal
  keeps it busy.
- No conversation deletion.
- TypeScript by choice ("the easiest way to bootstrap this"), with a Rust port
  not ruled out.

Cloudflare `PiHarness` (Agents SDK, beta) adds its own, listed in
[pi-durable-cloudflare.md](pi-durable-cloudflare.md#limits-cloudflare-documents):
one model request streaming over 15 minutes can be cut off by the alarm
boundary, background completion is noticed up to 30 seconds late, and a running
session does not drain on eviction.

## Sources

- Pi Durable announcement — <https://earendil.com/posts/pi-durable/>
- `packages/durable/README.md` at tag `v1.4.0` —
  <https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/README.md>
- npm — <https://www.npmjs.com/package/@earendil-works/pi-durable>
- Cloudflare Agents docs, Pi harness (limitations) —
  <https://developers.cloudflare.com/agents/harnesses/pi/>
