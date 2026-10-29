# Pi Durable on Cloudflare

Working note. How Pi Durable lands on a Durable Object: the supported route
through the Agents SDK, the hand-rolled route, the wake/alarm mapping that makes
it work, and the limits Cloudflare documents.

Background on the harness itself is in [pi-durable.md](pi-durable.md). Checked
2026-10-29 against `@earendil-works/pi-durable@1.4.0`, `agents@0.31.0` and the
Agents SDK harness docs (`PiHarness`, beta).

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
- Wrangler needs a SQLite-backed class and `nodejs_compat`:

```jsonc
{
  "compatibility_date": "2026-10-28",
  "compatibility_flags": ["nodejs_compat"],
  "ai": { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "Assistant", "class_name": "Assistant" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Assistant"] }]
}
```

Version coupling, because Pi Durable's API moves in minors: the Pi packages are
optional peers of `agents` at `~1.4.0`, each `agents` release supports exactly one
Pi minor, and Agents SDK 0.30.0 or later supports Pi 1.4.

## Route 2 — hand-rolled in a Durable Object

Same storage adapter, no SDK. The snippet below is from the pi-durable 1.4.0
README, which documents the contract. Earendil's sample
(`earendil-works/pi-durable-cloudflare`) opens differently: it sets no fallback
alarm and rebuilds the alarm from `harness.inspect()` (see below).

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
  work runs. `agents` uses a 30-second constant (`HEARTBEAT_MS`) and waits on Pi
  for at most 10 minutes per alarm (`WAIT_BUDGET_MS`).
- The Agents SDK `PiHarness` does exactly this with a Lifecycle job: it holds a
  heartbeat while Pi works, is due when the next sleeping task wakes, and
  completes when Pi has nothing to do — which is what lets the object hibernate.

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
| The model was streaming | The partial answer stays, the model call is made again |
| A `replay: "safe"` tool was running | It runs again |
| Any other tool was running | It does not run again; the model gets an interrupted result |

While Pi has work the heartbeat alarm fires about every 30 seconds, so a crashed
object restarts within that window. A task cut off `settings.restartLimit` times
in a row (default 5) without progress is **parked** instead of restarting the
object forever: the job completes, the object hibernates, `pending()` reports
`parked`, `wait()` keeps waiting, and `session.retry()` resumes it once the cause
is fixed. `onReport` gets `task_parked` when a reporter is configured.

## Session surface

`PiHarness` wraps a conversation as a session; the root session has the id `"1"`.

| Method | Note |
| --- | --- |
| `submit(input, { operationId, whenBusy, entry })` | Durably stored before the model runs; same `operationId` returns the same operation with `accepted: false` |
| `prompt(input)` | Submit and wait; returns `text`, `status`, `messages` |
| `steer(input)` | Submit with `whenBusy: "steer"` — joins after the current tool round |
| `wait(operationId, signal)` | Aborting the signal stops the wait, not the work |
| `abort(operationId)` | Withdraw a queued operation or abort the run it joined; no id aborts everything |
| `pending()` | `queued`, `running`, `parked` |
| `retry()` | Run again the tasks the restart limit parked |
| `reset(handoff)` / `setModel()` / `messages()` / `events()` / `busy()` | — |

- Session ids are Pi's conversation ids; you cannot choose them. To give each
  user or chat its own agent, use one Durable Object per conversation and the
  root session inside it.
- `entry` lets you label input the user did not type (`app.approval`,
  `app.webhook`) while the model still sees it as a user message. `pi.` prefixes
  are reserved. The kind is a label, not a permission — never put in it what you
  would not let a user send.
- `settings.afterFailedRun` decides the fate of input queued behind a failed run:
  `keep` (default, waits for the next submit or reset), `continue`, or
  `withdraw`.
- Event streams begin with a snapshot and then follow live commits. There is no
  cursor, and the stream lives in memory: after a restart, open a new one.

## Limits Cloudflare documents

- No built-in approval or permission step for tool calls; build one with a
  [`beforeTool` hook plus `api.memo`](https://earendil.com/posts/pi-durable/).
- No event replay; reconnect means a new snapshot.
- `abort()` waits until the session is idle.
- An alarm invocation runs up to 15 minutes and the harness hands off every 10,
  so **one model request that streams for more than 15 minutes can be cut off**.
- Background task completion is noticed up to 30 seconds late (heartbeat).
- A running session keeps work in flight, so the object does not drain while Pi
  runs.
- Conversations cannot be deleted yet.

## Vocabulary

Three names for the same thing, which makes reading across the stack slower than
it should be:

| Layer | Word |
| --- | --- |
| Pi Durable (1.4.0 README, announcement) | conversation |
| `PiHarness` (Agents SDK) | session (root id `"1"`) |
| A search snippet of the Sentry guide | lane (unconfirmed) |

`lane` also appears with a distinct meaning — "a named position in the
conversation tree, one operation at a time, parallel lanes" — which the 1.4.0
README does not describe. Treat that wording as unconfirmed for 1.4.0 and check
the source when it matters.

## Samples

- `earendil-works/pi-durable-cloudflare` — the multiplayer chat from Earendil's
  post: one DO per session, pinned to pi-durable/pi-ai/chord **1.2.0** (not 1.4.0), hibernatable WebSockets, multiple conversations and
  forks, scheduled self-wake, a `search_history` subagent. Runs locally with Node
  22.19+, pnpm 11 and an OpenAI key in `.dev.vars`; **no authentication** on
  purpose.
- `cloudflare/agents` → `examples/next/harnesses/pi` — a complete app with
  WebSocket sessions plus a durable filesystem and JavaScript execution from
  `@cloudflare/computer`.

Neither is a coding TUI. Both are applications you build, and the code the agent
edits lives in the object's workspace, not in a repo on your laptop — see
[multi-machine-continuity.md](multi-machine-continuity.md).

## Secondary sources, not verified here

Seen in search results only; no page fetched, so no claim is made beyond their
existence: Vercel documents "Running Pi Durably on Vercel"
(`durable-harness/pi-durable`, `durable-harness/pi`), and Sentry documents Agent
Tracing for Pi Durable on Cloudflare and Node (`>=1.0.0 <2.0.0`, JS SDK 11.6.0+).

## Sources

- `agents@0.31.0` npm package: `docs/harnesses/pi.md`, `dist/harness/pi`
  (`HEARTBEAT_MS`, `WAIT_BUDGET_MS`)
- Pi Durable announcement (approval via `beforeTool` + `api.memo`) —
  <https://earendil.com/posts/pi-durable/>
- Cloudflare Agents docs, Pi harness (primary) —
  <https://developers.cloudflare.com/agents/harnesses/pi/>
- Cloudflare changelog, 2026-10-02 — <https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/>
- Earendil, "Pi Durable on Cloudflare" (primary, 2026-10-16) —
  <https://earendil.com/posts/pi-durable-on-cloudflare/>
- `packages/durable/README.md` at tag `v1.4.0`, storage and `onWake` contract —
  <https://github.com/earendil-works/pi/blob/v1.4.0/packages/durable/README.md>
- Sample app — <https://github.com/earendil-works/pi-durable-cloudflare>
- SDK example — <https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi>
