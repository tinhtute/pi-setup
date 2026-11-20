# Pi Durable on Cloudflare — use cases

Working note. What people actually build with the pairing, what Cloudflare
supports out of the box, and the one team that shipped it and then left.
Compiled 2026-11-19 from public sources; every claim names where it came from.

Read [pi-durable.md](pi-durable.md) for the model and
[pi-durable-cloudflare.md](pi-durable-cloudflare.md) for the mechanics.

## The shape that keeps recurring

One conversation per Durable Object, Pi owning the transcript/tasks, the object
hibernating between turns. Every project below is a variation on that, and the
variation is always what the agent touches: files, a shell, a mailbox, a repo.

## Shipped and running

| Project | What it is | Why durable matters |
| --- | --- | --- |
| **camelCode** (`qaml-ai/camelAI`) | Coding agent; one DO per chat thread; filesystem in SQLite with R2 behind it; the agent writes JavaScript instead of bash | Dropped VMs for cost: an always-on VM with attached disk per user does not scale. One brain can drive several "hands" |
| **Pi Durable SRE Agent** (`GIFO14/Pi-Durable-SRE-Agent`) | One incident owned by one durable task; real checkout edits and real test runs; canary deploy and promotion are human approvals | Task ID, evidence and both approval gates survive Ctrl+C. Tests cover SIGKILL recovery, duplicate approvals, rollback |
| **durable-pi** (`disler/durable-pi`) | Personal agent network: device backend, hub, TUI and web client, proactive incident agents | Persistent multi-device state; a watcher can start work with nobody watching |
| **ultimate** (`HazAT/ultimate`) | Local coding agent with a web UI that builds itself while it runs | The UI is a client of committed state, not of a process |
| **pi-on-cf** (`harshil1712/pi-on-cf`) | Pi on Cloudflare with a durable `/workspace`, three exec backends: Worker Shell, Worker JavaScript, and a DO-scheduled Linux container | The exec boundary is a choice, not a VM |
| **pi-on-phone** (Mario Zechner, Pi's author) | Pi Durable running on Android, state local, model calls remote | Separation of harness from compute is the whole point |
| **pi-durable-cloudflare** (Earendil) | Multiplayer chat: hibernatable WebSockets, several conversations and forks, scheduled self-wake, a `search_history` subagent | The reference layout for a shared session |

Portability is real: the same package runs on Vercel (`durable-harness/pi-durable`),
on GKE (`taeold/pi-durable-substrate`), on Node with SQLite or JSONL, and in a DO.

## Four use-case families, ranked by how well the stack fits

1. **High-stakes workflows that must not double-fire.** Refunds, deploys,
   ticket edits. The value is not "it recovers" but "it knows a call was
   interrupted and does not silently replay it" — tools are only re-run when
   marked `replay: "safe"`. This is the strongest fit.
2. **Multiplayer sessions.** Several people on one conversation: queue a
   follow-up or steer the running work; everyone sees committed state. Coding
   agent with teammates watching from phone/browser/terminal is the stated
   target.
3. **Channel-shaped agents.** Cloudflare's own preset gives chat, voice, email,
   Slack and webhook inputs to one durable object. Pi's own example page is
   described as "a streaming AI chat agent with tools and human-in-the-loop
   approvals" — so a support inbox or a Slack ops bot is mostly wiring.
4. **Tools built on agent state.** Because tasks, checkpoints and interrupted
   calls are stored, you can render them without waking the agent: debugging
   dashboards, reliability metrics per tool, who steered what and when.

Weakest fit: a single long interactive session with a human waiting. You pay
durability costs (checkpointing, restarts) for latency you feel.

## The counter-case, with numbers

camelAI shipped on Durable Objects in July 2026 and moved off in September. Their
complaints, all concrete:

- **128 MB per object.** One long chat hit the limit about **2,500 times in two
  days** before they capped buffers.
- **Restarts on every deploy**, plus surprise runtime restarts; some cold starts
  measured over **10 seconds**. Every restart cost them recovery code and
  latency.
- **Debugging.** Production memory resets say nothing about what held the
  memory; WebSocket connects failed without explanation; they fell back to HTTP
  polling.
- **Cost.** Cheaper than VMs on average, but checkpointing added to the bill.
- Separately, D1 rejected sub-millisecond queries on a **5.6 MB** database
  (`D1 DB is overloaded`), which they traced to a noisy-neighbour storage
  threading issue.

Their verdict: Cloudflare for prototypes, MVPs and internal tools; not for a
long-running agent with paying users. That is a product judgment, not a bug
report, and it is the sharpest counterweight to the marketing.

Two things it does not settle: they were running their **own** harness on Pi's
lower layers, not `PiHarness`, and the memory ceiling is a Durable Object limit
that hits any harness the same way. A DO holds your code, libraries and agent
state together, so a long transcript plus a big tool output is your problem to
bound, not Pi's.

## The alternative shape Cloudflare now documents

`agents/harness/store` records an agent that runs somewhere else: the object
keeps the session, the inbox, the transcript and the settled result, and the
process doing the work reports progress into it. That is the answer to the
memory and restart complaints — the object becomes a record, not the runtime —
and it is the same split camelAI calls "brain and hands".

Cloudflare also documents a from-scratch harness (`Lifecycle` + `Sessions` +
`Streams` + `Tasks`) for people who want the shape without Pi.

## Decisions this forces before writing code

- **Which side owns the work?** DO as runtime (PiHarness) or DO as record
  (`harness/store`) with the runtime elsewhere. Memory ceiling and restart
  tolerance decide it.
- **Plain `DurableObject` or the `Agent` preset?** The docs sample extends
  `DurableObject` and installs `Lifecycle` by hand; the changelog sample extends
  `Agent<Env>` and calls `this.lifecycle.use(this.harness)`. The preset is what
  brings channels (chat, email, Slack, voice, webhooks) — needed for family 3,
  unnecessary for family 1.
- **What touches the outside world?** Every tool that charges, writes or
  deploys stays non-`replay: "safe"`; the approval gate goes in a `beforeTool`
  hook with `api.memo`.
- **How big can one conversation get?** Set compaction, cap tool output, and
  assume the object restarts mid-run.

## Open questions

- No public cost model for PiHarness on DOs: checkpoint volume per turn is not
  documented, and camelAI's complaint about checkpoint billing is unexplained.
- Nobody has published a PiHarness deployment at scale; the largest public
  evidence is camelAI's own harness on the same primitives.
- `agents` issue #2474 ("Move agents-starter to the Pi harness") is open, so the
  default starter may change shape under you.
- Whether multi-session-per-object is worth it: pi-durable supports it, the
  Cloudflare docs still recommend one DO per conversation.

## Vocabulary check

"Lane" appears in third-party summaries of a newer Pi harness design, never in
the pi-durable 1.5.2 package. Ignore it when reading code.

## Sources

- Superlinear, "4 things worth building with Pi Durable and Cloudflare Durable
  Objects" (fetched) —
  <https://superlinear.fm/blog/4-things-worth-building-with-pi-durable-and-cloudflare-durable-objects>
- camelAI, "Our coding agent runs in a Cloudflare Durable Object, not a VM"
  (2026-07-28, update Sep 2026; fetched) —
  <https://camelai.com/blog/our-coding-agent-runs-in-a-cloudflare-durable-object-not-a-vm>
- camelAI, "Should you build on Cloudflare? What we learned from D1 and Durable
  Objects" (2026-09-30; fetched) —
  <https://camelai.com/blog/should-you-build-on-cloudflare>
- `GIFO14/Pi-Durable-SRE-Agent` README (fetched) —
  <https://github.com/GIFO14/Pi-Durable-SRE-Agent>
- Cloudflare Agents docs index (channels, harnesses, Pi agent description) —
  <https://developers.cloudflare.com/agents/>
- Cloudflare Agents docs, "Build your own harness" (`harness/store` record
  pattern) — <https://developers.cloudflare.com/agents/harnesses/build-your-own/>
- Cloudflare changelog, 2026-10-02 (`Agent` preset sample) —
  <https://developers.cloudflare.com/changelog/post/2026-10-02-pi-harness/>
- `cloudflare/agents` issue #2474 —
  <https://github.com/cloudflare/agents/issues/2474>
- `harshil1712/pi-on-cf`, `HazAT/ultimate`, `disler/durable-pi`,
  `taeold/pi-durable-substrate` READMEs (search snippets only)
- Hacker News thread on Pi Durable (peer commentary on the library-vs-SDK
  split) — <https://news.ycombinator.com/item?id=49925969>
