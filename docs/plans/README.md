# Roadmap (future work)

Reviewed, **not-yet-shipped** features worth holding onto. Shipped behavior lives in the live
book (`docs/`), guides under `docs/guides/` / `docs/services/`, and source TSDoc — not here.
Pre-1.0: breaking changes land as minor bumps.

## Toolkit

- **Repo source viewer (`/repo/…`)** — soft-nav splat → real package/source file → Twoslash (then viewer, much later editor). Parked until context/link goals settle: [`../handoffs/repo-source-viewer-park.md`](../handoffs/repo-source-viewer-park.md).
- **last-ts codesplit** — Effect+React building blocks package (`Last`, `View`, `Route`/`Router`, `Page`, vite/docgen); Hyperlink keeps `Ui` size chrome + Dashboard. Plan: [last-ts-codesplit.md](./last-ts-codesplit.md).
- **Service / contract shapes** — taxonomy for materialize vs pull vs Tag-baked / adapters. Draft: [service-shapes.md](./service-shapes.md). Eng’d: `Tag`/`value`/`promise`/`default`/`defaults` + factory `{ defaults }` (`pure` retired); `cell` parked/rejected.
- **Wire groups & identity** — regular RpcGroup = tag key; shared Spec = `Tag(wireKey, spec)` → `Factory<Self>()(instanceKey)` (kind-keyed wire, ordinary serve/client). W1–W3 Eng’d: [wire-groups-and-identity.md](./wire-groups-and-identity.md).
- **Guaranteed barrel-namespace tree-shaking** — make `import { WorkPool } from "hyperlink-ts"` + `WorkPool.Service` tree-shake the engine in *every* bundler (subpath imports already do). Detailed plan: [18-unbundled-build-treeshaking.md](./18-unbundled-build-treeshaking.md).
- **Hyperlink-RPC auth** — a first-class authentication/authorization story for served resources (deployments use an edge gateway / Cloudflare Zero Trust short-term). Spec TBD when scope is locked; stays a roadmap bullet until then.

## Orchestration

- **`Update` module + addresses / Machine** — design only: `Update.plan`→simulate→`execute` (fleet-ordered, contract from→to audit); main+A/B addresses / proxy; Update/Machine node (deploy, webhook/pull/packages); possible Launcher→Machine spine reopen. Separate from Eng’d `Versioned`. Notes: [`../handoffs/node-addresses-and-update-api.md`](../handoffs/node-addresses-and-update-api.md).
- **Weighted middle scheduling** — diversify the queue's middle priority into many weighted numeric/named groups pulled by a non-starving algorithm (DRR / strict), fixing strict-priority starvation. Design spec: [weighted-middle-scheduling.md](./weighted-middle-scheduling.md).
- **Non-serializable queue items** — local-only enqueue for function/`Effect` items; wire control + observability stay served. [queue-nonserializable-items.md](./queue-nonserializable-items.md).
- **Standalone spawns** — `Daemon.spawn` / `WorkPool.open`: multi-instance ergonomics where spawned handles are plain caller-scoped Effects (alongside `Group`).
- **Runtime identity & singleton runs** — in-process registry + a durable cross-runtime lease to prevent duplicate runs of the same logical process across hosts.
- **Lifecycle kernel** — Effect-native Lifecycle (FiberHandle/Latch + Participating duals); tools via `start(lc|jobs|Tag)` without kind switches. **L0–L7 Eng’d** (P10 Gate + P12 Rejected). Plan: [lifecycle-kernel.md](./lifecycle-kernel.md) · locks: [lifecycle-kernel-decisions.md](../handoffs/lifecycle-kernel-decisions.md).

## Persistence & storage

- **Storage correctness Soft stack** — **shipped** [#62](https://github.com/NikScripts/effect-pm/pull/62)/[#65](https://github.com/NikScripts/effect-pm/pull/65) (bake+override + untyped WorkPool Soft parity). Living plan: [storage-correctness.md](./storage-correctness.md). Remaining: fail-loud Soft / Phase C–D / Postgres (owner-gated).
- **Postgres backends** for `HistoryStore` and `DurableWorkPoolStore` (same interfaces; today: in-memory + SQLite).
- **Storage-adapter integration testing** — real-DB integration suites beyond the in-memory conformance tests.
- **Richer history vocabulary + listener/stream hooks** — for domains that need more than append-only facts, layered *beside* the store (never a process-store monolith).

## Durable queue refinements

(Both deferred in the durable-queue v1.)

- **Metrics downsampling** — roll windows 1s → 1m → 1h for long retention.
- **Multi-worker visibility-timeout / lease refresh** — v1 is single-host with a generous lease; add lease-refresh + `SKIP LOCKED` multi-worker semantics.

## Agent tooling

- **`outside-opinion`** ("this agent is being a moron" button) — owner-triggered escalation that
  fans out to 4+ fresh sessions on *different* models, each asked what the stuck agent is
  missing, with a small model consolidating and the owner gating what reaches the stuck agent.
  Idea + prior-art survey + the three failure modes that decide whether it works (anchoring,
  consensus-ranking, over-applied doubt): [outside-opinion.md](./outside-opinion.md).
- **Rival agents** — one or more agents that follow a session and speak *only* when they
  disagree. Sibling to the panel with inverted economics (cheap + continuous vs. expensive +
  on-demand); the closest precedent is a linter, and the lesson is tune for precision, not
  recall: [rival-agent.md](./rival-agent.md).
- **Chat surface + attachment tray** — left-aligned bubbles as a third voice (you / main agent /
  outside agents), the composer states `outside-opinion` needs, and a general attachment tray
  (pills by type, images as tiles). Closes the open "what does `+` attach?" question in the
  composer handoff: [chat-surface-and-attachments.md](./chat-surface-and-attachments.md).

## Hygiene

- Parked erase debt (`toLayer` / wire `provideContext` / D1 factory retypes) — see archived
  [any-unknown-in-error-context.md](./archive/any-unknown-in-error-context.md).

## Archived (shipped)

Plans that finished Eng and left this index:

- [observe-recipes.md](./archive/observe-recipes.md)
- [fleet-rate-limiting.md](./archive/fleet-rate-limiting.md)
- [any-unknown-in-error-context.md](./archive/any-unknown-in-error-context.md)
