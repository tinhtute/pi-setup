# Pi Durable on Cloudflare

Working note. How Pi Durable lands on a Durable Object: the supported route
through the Agents SDK, the hand-rolled route, the wake/alarm mapping that makes
it work, and the limits Cloudflare documents.

Background on the harness itself is in [pi-durable.md](pi-durable.md). Re-checked
2026-11-19 against `@earendil-works/pi-durable@1.5.2`, `agents@0.33.0` and the
Agents SDK harness docs (beta, page updated 2026-11-03). Official sources only:
the published packages, Cloudflare's docs and changelog, the Earendil repository
and blog, npm, and the two vendor pages listed at the end.

## Why the pairing makes sense

An agent that answers a request and then sits idle for hours does not justify a
machine that stays up. A Durable Object hibernates when nothing needs it and
comes back on a request, a WebSocket message or an alarm. Pi Durable is built for
long runs and has no opinion about where its storage lives.

A Pi Durable harness is scoped to one session, which maps cleanly to one Durable
Object instance addressed by the session id:

```text
client ──▶ Worker ──▶ Durable Object (by session id)
                       ├── hibernatable WebSockets
                       ├── SQLite database (Pi's tables, prefix pi_)
                       └── Pi Durable Harness ──▶ model provider
```

## Route 1 — the Agents SDK `PiHarness` (supported, beta)

`PiHarness` ships in Cloudflare's `agents` package (`agents/harness/pi`), not in
pi-durable. It is beta, and it is a **Lifecycle capability**: a reusable piece of a Durable Object
that the Lifecycle starts and gives SQLite storage plus a durable job queue.

```ts
import { DurableObject } from "cloudflare:workers";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";

export class Assistant extends DurableObject<Env> {
  ai = createAI({ binding: this.env.AI });
  registry = createRegistry();

  harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);
      return Harness.open(storage, { models, registry: this.registry, onWake }, context);
    },
    defaults: { model: this.ai("@cf/zai-org/glm-5.3-flash"), thinkingLevel: "low" },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);

  async ask(prompt: string) {
    return (await this.harness.prompt(prompt)).text;
  }
}
```

What the SDK supplies and what stays yours:

| Piece | Owner |
| --- | --- |
| Storage over the DO's SQLite (`pi_`-prefixed tables) | SDK |
| The wake job and its heartbeat | SDK (`Lifecycle`) |
| Sockets, RPC, HTTP transport | You |
| Models, registry, `settings`, `env`, `onReport` | You, in the `harness` factory |

- The factory runs during object startup and again whenever the harness reopens
  Pi after a storage error, so it must be safe to run more than once. Every
  `PiHarness` operation waits for startup.
- Models come from `agents/models/pi-ai`: Workers AI through the `AI` binding, or
  other vendors through AI Gateway. `createAI({ binding })` hands back a provider
  and a `ai("@cf/...")` model helper.
- `defaults` sets what a new session starts with: `model`, `thinkingLevel` and
  `maxTurns` (the most tool rounds one run takes; reaching it ends the run
  unanswered with reason `turn_limit`). `maxTurns` is new in the 1.5 line.
- Wrangler needs a SQLite-backed class and `nodejs_compat`:

```jsonc
{
  "compatibility_date": "2026-11-19",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "Assistant", "class_name": "Assistant" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Assistant"] }]
}
```

Two things the sample does not say, verified by running it on 2026-11-19:

- `@cf/zai-org/glm-5.3-flash` is not on the Workers **Free** plan (Workers AI
  error 5035). On Free, `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and
  `@cf/qwen/qwen2.5-coder-32b-instruct` answer; `@cf/google/gemma-3-12b-it` does
  not (5018). A model the account cannot reach does not fail fast: Pi retries it
  under `settings.retry`, so `prompt()` hangs for about 90 seconds before the run
  settles `unanswered` with reason `model_error`, and `pi.live.runFailure.detail`
  holds the provider's own text. `defaults.model` applies to new sessions only,
  so changing it in code does not repoint a session that already exists — use
  `session.setModel()`, or the old model keeps failing every prompt.
- `wrangler dev` proxies the AI binding **remotely** and refuses to start without
  a `CLOUDFLARE_API_TOKEN` even though the Durable Object itself is local. To run
  the object with no account at all, delete the `ai` binding and make the factory
  skip `setProvider` and `defaults.model`; prompts then settle `unanswered` with
  reason `no_model`, which still exercises storage, sessions and restarts.

Version coupling, because Pi Durable's API moves in minors: the Pi packages are
optional peers of `agents`, now at `~1.5.0` for `pi-durable`, `pi-ai`,
`pi-schema` and `chord`. Each `agents` release supports exactly one Pi minor, and
Agents SDK 0.33.0 or later supports Pi 1.5. The coupling is one-way: a
conversation that has run on Pi 1.5 cannot be read by an `agents` release built
on Pi 1.4, so a bad deploy is a **roll-forward** problem, not a rollback. Pin the
versions and treat a Pi minor bump as a migration.

## Route 2 — hand-rolled in a Durable Object

Same storage adapter, no SDK. The snippet below is from the pi-durable 1.5.2
README, which documents the contract, and it is unchanged from 1.4.0 in shape.
Earendil's sample (`earendil-works/pi-durable-cloudflare`) opens differently: it
sets no fallback alarm and rebuilds the alarm from `harness.inspect()`.

```ts
constructor(ctx: DurableObjectState, env: Env) {
  super(ctx, env);
  void ctx.blockConcurrencyWhile(async () => {
    // Fallback before anything can throw: an object whose open or recovery
    // fails gets started again.
    const fallback = Date.now() + 60_000;
    const current = await ctx.storage.getAlarm();
    if (current === null || current > fallback) await ctx.storage.setAlarm(fallback);

    const storage = await openDurableObjectSqliteStorage(ctx.storage);
    const onWake = (wake: Wake) =>
      void this.#arm(wake).catch(() => ctx.abort("Alarm write failed"));
    this.#harness = await Harness.open(storage, { models, registry, onWake }, BACKGROUND_CONTEXT);
    // Armed before resume(): every call that can start work comes after the alarm.
    await this.#arm(this.#harness.wake());
    this.#harness.resume(); // continue any run the last process left unfinished
  });
}
```

`BACKGROUND_CONTEXT` is Chord's background context: it never cancels and uses a
no-op telemetry span.

Two details that are easy to get wrong:

- A storage error closes the harness (`harness.closed`, `end.reason === "failed"`).
  Abort the object so the next event reopens it in a known state.
- Arm the alarm **before** anything that can start work, including `resume()`.

## What 1.5 changed that invalidates older samples

1.4.0-era example code (including Earendil's original post and the 1.2.0 sample)
does not compile against 1.5. The items that matter here:

| 1.4.0 shape | 1.5.2 shape |
| --- | --- |
| `watchEvents()` and its `AgentEvent` stream | Removed. `watch()` returns a `ConversationWatch`: a value, then commits with their ops |
| `ConversationView.entries` was the whole transcript | A window: 50 entries at attach, grows to 100, oldest leave in one splice |
| `conversation.entries()` was a view over the active transcript | Pages the fork-aware history, including entries before resets |
| Tool schemas from `@earendil-works/pi-ai` (`Type.Object`) | `@earendil-works/pi-schema` (`obj`, `str`, `num`); `typebox` dropped |
| `storage.commit(writes, adopt, context)` | `storage.commit(batches, receive, context)`, one atomic commit per batch |
| Watch ends: `session_closed` / `session_failed`, plus `retired` | `ended` / `failed`; a retired document arrives as `retired: true` on the next call |
| Progress stored per partial | Batched up to `settings.progress.persistWithinMs` (default 1,000 ms) |
| Parked tasks + `session.retry()` | `settings.restartLimit` ends the task; recover with `session.continue()` |

## The wake and alarm mapping

This is the part that makes the whole thing work, and the part worth reading
before designing anything on top.

- Pi's scheduler and its sleeps live in memory. An evicted object has none.
- Pi does not arm its own timers when `onWake` is passed. It reports what
  `harness.wake()` says whenever that changes: `active` while some task can run
  now or is running, and `at`, the earliest sleep deadline.
- A Durable Object has **one** alarm; Pi can have many deadlines. The host keeps
  a single alarm and recomputes it from the stored task set after every wake:
  future deadlines set the alarm to the minimum, work that can run now gets a
  short recovery alarm, and the handler is idempotent because alarms are
  at-least-once.
- The README's hand-rolled example arms a 60-second recovery heartbeat while
  work runs. `agents@0.33.0` exposes the same three knobs as `WakeTiming`
  defaults: `waitBudgetMs` 600,000, `heartbeatMs` 30,000, `pollMs` 1,000
  (`WAIT_BUDGET_MS`, `HEARTBEAT_MS`, `POLL_MS`). The wait budget is what keeps
  one alarm invocation well inside Cloudflare's 15-minute limit.
- The Agents SDK `PiHarness` does exactly this with one Lifecycle job: it holds a
  heartbeat while Pi works, is due when the next sleeping task wakes, and
  completes when Pi has nothing to do — which is what lets the object hibernate.
  A failing wake backs off by doubling the heartbeat up to 10 minutes instead of
  completing the job and never waking Pi again.

Sample recomputation, from Earendil's post:

```ts
async alarm() {
  await this.#refreshAlarm();
}

async #refreshAlarm() {
  return this.#serializeAlarmUpdate(async () => {
    const { tasks } = await this.#harness.inspect(BACKGROUND_CONTEXT);
    const now = Date.now();
    let nextAlarm: number | undefined;
    const tasksToResume: TaskId[] = [];

    for (const task of tasks) {
      if (task.state.kind === "blocked") continue;
      const scheduled = scheduledDeadline(task);
      const waitsForFuture =
        scheduled !== undefined && scheduled > now && !task.record.abortRequested;
      const deadline = waitsForFuture ? scheduled : now + RECOVERY_ALARM_DELAY_MS;
      nextAlarm = nextAlarm === undefined ? deadline : Math.min(nextAlarm, deadline);
      if (!waitsForFuture) tasksToResume.push(task.record.id);
    }

    await this.#replaceAlarm(nextAlarm);
    for (const taskId of tasksToResume) this.#refreshAlarmWhenTaskSettles(taskId);
  });
}
```

## Recovery, as documented

| What happens | Result |
| --- | --- |
| Object evicted, crashes, or exceeds its memory/CPU limit | The wake job's next alarm restarts it; Pi continues from its last checkpoint |
| Deploy mid-run | Same as a crash; in-flight work gets 30 seconds, then the alarm restarts the object |
| The model was streaming | The partial answer is kept, the request counts as a failed attempt under `settings.retry`, and Pi calls the model again after the backoff. With no retry left the run ends unanswered with reason `interrupted` |
| A `replay: "safe"` tool was running | It runs again |
| Any other tool was running | It does not run again; the model gets an interrupted result |

While Pi has work the heartbeat alarm fires about every 30 seconds, so a crashed
object restarts within that window. Progress is stored in batches, so a crash
loses up to `settings.progress.persistWithinMs` (default 1,000 ms) of a stream;
set it to `0` to store every update at one write each.

A task that keeps crashing the object would restart it forever. Once a crash or
eviction cuts a task off `settings.restartLimit` times in a row (default 5,
`Infinity` disables it), the task ends instead of running again: a tool call gets
an error result with diagnostic code `restart_limit` and the run continues, while
a model request ends its run `unanswered` with reason `restart_limit`. Either way
the job completes, the object can hibernate, and Pi reports it to `onReport` as
`task_interrupted`. To run the work again, call `session.continue()` or submit it
again. There is no parked state and no `retry()` in 1.5.

## Session surface

`PiHarness` wraps a conversation as a session; the root session has the id `"1"`,
and every method takes an optional `session`.

| Method | Note |
| --- | --- |
| `submit(input, { operationId, whenBusy, whenIdle, entry })` | Durably stored before the model runs; same `operationId` returns the same operation with `accepted: false` |
| `prompt(input)` | Submit and wait; returns `text`, `status`, `messages` |
| `continue()` | Start a run on the transcript as it is, with no new message. Idle sessions only; a busy one rejects with `ConversationBusy` |
| `steer(input)` | Submit with `whenBusy: "steer"` — joins after the current tool round |
| `wait(operationId, signal)` | Aborting the signal stops the wait, not the work |
| `abort(operationId)` | Withdraw a queued operation or abort the run it joined; no id aborts everything |
| `pending()` | `queued` or `running` — and nothing else |
| `watch(window)` | The session's view: newest entries plus `pi.live` (streamed answer, running tools, `runFailure`) |
| `entries(query, limit)` | A page of the transcript, including entries before resets |
| `reset(handoff)` / `setModel()` / `messages()` / `busy()` | — |

The harness also has `sessions.create()`, `sessions.fork(id)` and
`sessions.list()`; the list includes conversations Pi's subagent tools created.

- Session ids are Pi's conversation ids; you cannot choose them. To give each
  user or chat its own agent, use one Durable Object per conversation and the
  root session inside it.
- `entry` lets you label input the user did not type (`app.approval`,
  `app.webhook`) while the model still sees it as a user message. `pi.` prefixes
  are reserved. The kind is a label, not a permission — never put in it what you
  would not let a user send.
- `whenIdle: "reject"` makes an idle session refuse input with
  `ConversationIdle` instead of starting a run.
- `settings.afterFailedRun` decides the fate of input queued behind a failed run:
  `keep` (default, waits for the next submit or reset), `continue`, or
  `withdraw`.
- An operation settles `unanswered` with one of: `model_error`, `no_model`,
  `turn_limit`, `interrupted`, `restart_limit`, `run_failed`,
  `nothing_to_answer`.
- A watch begins with a value and then follows live commits; it lives in
  memory, so a restarted object means a new watch. There is still no persisted
  cursor, but a reconnect is cheaper than it was: the value is a window, and
  `watch({ from })` (or a `ConversationTranscript`'s `resume`) sends only the
  entries a client missed. Render more than the window by paging with
  `entries()`; apply a change's `ops` with `applyImmutable()` from
  `@earendil-works/chord/delta`.

## Limits Cloudflare documents

- No built-in approval or permission step for tool calls; build one with a
  [`beforeTool` hook plus `api.memo`](https://earendil.com/posts/pi-durable/).
- No event replay: a watch starts from a window, not a history you can seek.
- `abort()` waits until the session is idle.
- An alarm invocation runs up to 15 minutes and the harness hands off every 10,
  so **one model request that streams for more than 15 minutes can be cut off**.
- Background task completion is noticed up to 30 seconds late (heartbeat).
- A running session keeps work in flight, so the object does not drain while Pi
  runs.
- Conversations cannot be deleted yet.
- A Pi minor bump is one-way: a conversation written by Pi 1.5 stays unreadable
  to an SDK on Pi 1.4, so fix a bad deploy by rolling forward.
- Workers AI model availability is a plan boundary, not a config one: the docs
  sample's model answers 5035 on Free, and the failure arrives as a retry stall
  rather than an error.

## Vocabulary

Three names for the same thing, which makes reading across the stack slower than
it should be:

| Layer | Word |
| --- | --- |
| Pi Durable (1.5.2 README, announcement) | conversation |
| `PiHarness` (Agents SDK) | session (root id `"1"`) |
| Some third-party write-ups | lane |

`lane` does not appear anywhere in the 1.5.2 README or `dist`, so it is not a
name this package uses. It describes a different, newer harness design ("a named
position in the conversation tree, one operation at a time, parallel lanes");
that design is not what `PiHarness` exposes. Ignore the word when reading Pi
Durable 1.5.2 code.

## Samples

- `earendil-works/pi-durable-cloudflare` — the multiplayer chat from Earendil's
  post: one DO per session, hibernatable WebSockets, multiple conversations and
  forks, scheduled self-wake, a `search_history` subagent. Its `package.json`
  pins chord, pi-ai, pi-durable and pi-schema to **1.5.2** as of this check
  (it was 1.2.0 when the post was written, which is why the post's
  `watchEvents()` code no longer matches). Runs locally with Node 22.19+,
  pnpm 11 and an OpenAI key in `.dev.vars`; **no authentication** on purpose.
- `cloudflare/agents` → `examples/next/harnesses/pi` — a complete app with
  WebSocket sessions plus a durable filesystem and JavaScript execution from
  `@cloudflare/computer`. Peer range is `~1.5.0`; the app keeps a client mirror
  in Pi's `ConversationTranscript` instead of consuming an event stream.
  "Each session is its own Durable Object with its own workspace", and Pi fixes a
  session's active tools when it creates it, so a session made before a tool was
  added never sees that tool.

Neither is a coding TUI. Both are applications you build, and the code the agent
edits lives in the object's workspace, not in a repo on your laptop — see
[multi-machine-continuity.md](multi-machine-continuity.md).

## Other vendor docs

Both verified as real pages on 2026-11-19, official to their vendor:

- Vercel, "Running Pi Durably on Vercel" — two packages,
  `durable-harness/pi-durable` (recommended: Pi's full `Harness` on
  `openWorldStorage()`, so each Pi commit is a log event) and `durable-harness/pi`
  (Pi's agent loop from `@earendil-works/pi-agent-core`, one step per model/tool
  call, less latency). The page describes Pi 1.0's Harness, so check which
  pi-durable minor it assumes before copying code.
- Sentry, "Sentry for Pi Durable (Cloudflare)" and its Node sibling — Agent
  Tracing for `@earendil-works/pi-durable` `>=1.0.0 <2.0.0`, `@sentry/cloudflare`
  11.6.0+, and `agents` 0.26.0+ when hosted through `PiHarness`. Its Vite plugin
  instruments `Harness.open()` at build time, so every harness the Worker opens
  is traced without changing the harness code.

## Sources

- npm, `@earendil-works/pi-durable@1.5.2` (published 2026-11-10): `README.md`
  (storage table, `onWake` contract, hand-rolled alarm sample, `restartLimit`),
  `CHANGELOG.md` (1.5.0 breaking changes, 1.5.1, 1.5.2)
- npm, `agents@0.33.0` (published 2026-11-03): `package.json` peer ranges and
  `exports`, `dist/harness/pi/index.js` and `index.d.ts` (`PiHarness`,
  `WakeTiming`, `PiSession`, pending statuses)
- Cloudflare Agents docs, Pi harness (beta, updated 2026-11-03) —
  <https://developers.cloudflare.com/agents/harnesses/pi/>
- Cloudflare changelog, 2026-10-02 — <https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/>
- Earendil, "Pi Durable on Cloudflare" (2026-10-16, 1.2.0-era code) —
  <https://earendil.com/posts/pi-durable-on-cloudflare/>
- Earendil, "Pi Durable" announcement — <https://earendil.com/posts/pi-durable/>
- Sample app, `package.json` on `main` —
  <https://github.com/earendil-works/pi-durable-cloudflare>
- SDK example and its README —
  <https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi>
