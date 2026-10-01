# DoubleAgent native: opencode v2 + message outbox

Owner decisions (2026-10-01), the source of truth for this work.

## Why

A message sent while its target folder was still being created went to the
previously selected session directory. The fix is a message queue that only
sends when it knows the server is ready, which also covers no connectivity,
the server being down, and the agent being busy.

## Decisions

1. **opencode v2, not v1.** "Should have always been v2." New sessions are
   created, prompted, read and streamed through v2 (`/api/session`,
   `/api/session/:id/prompt`, `/api/session/:id/model`,
   `/api/session/:id/message`, `/api/event`).
   - v1 and v2 keep separate message histories per session (verified live:
     v2 sees no v1 messages and v1 sees no v2 messages). Existing v1 sessions
     stay readable through v1; they are not prompted through v2 (the agent
     would start without the conversation).
2. **Queue is strictly ordered, per session.** It is a queue: a message never
   overtakes an earlier one. A message that cannot be sent holds its lane
   until it is retried or removed; it never silently drops or reorders.
3. **Per server.** Lanes are keyed by server and session; multi-server is
   planned.
4. **Works in the background.** `expo-background-task` drains what is still
   on the device (server unreachable); once admitted, v2 `delivery: "queue"`
   holds it on the server until the agent is idle, phone asleep or not.
5. **No status text on queued messages.** The app already has a status
   indicator at the top. Bubbles are tinted whether queued or sent (2026-10-01:
   the untinted queued look was dropped); how far a message got shows as an
   iOS Messages read receipt under your latest one: Sending… (in the
   outbox), Not Delivered (its lane held on it), Delivered (on the server),
   Read and the time (the agent's answer began).
6. **A new workspace folder is created only when send is hit** for the new
   session, as a step of that queued send, never earlier.
7. **Effect, maximum quality.** Schema at every boundary, tagged errors,
   services and layers, Schedule for retries, Stream/SubscriptionRef for
   state, FiberMap for lanes, KeyValueStore for persistence. No Promise or
   try/catch plumbing in the data layer.
8. **Failures never jam communication.** Transient failures retry with
   backoff and on reconnect; a permanent failure holds only its own lane
   (order), visible, retryable or removable; every step has a timeout.
9. **Performance to the max.** Event-driven, no polling while healthy, idle
   fibers, batched writes, only changed bubbles re-render.

## Exactly-once

v2 prompt takes a client message id (`SessionMessage.ID`) and reconciles an
exact retry with the same id instead of duplicating. The outbox generates the
id when the message is queued and reuses it on every attempt.

## Model per message

v2 has no model on the prompt. `switchModel` appends a `model-switched`
event to the session's ordered history, so the outbox switches the model (a
no-op when unchanged) immediately before admitting the message.

## Plan

1. Vendor opencode's `@opencode-ai/schema` (closure needed for sessions,
   messages, events, inputs) into `src/opencode/schema`, with a re-sync script
   pinned to the server's version.
2. `OpencodeV2` Effect client over `HttpClient`, decoding with the vendored
   schemas: session create/get/list, messages, prompt, switchModel,
   switchAgent, event stream.
3. `Outbox`: lanes, persistence, reachability, workers, background drain.
4. Chat on v2: transcript from v2 messages + `/api/event`, queued bubbles.
5. New sessions (Home, Repo) through the outbox, folder creation as a step.
6. Session list through v2.

## Status (2026-10-01)

Done, on `app/double-agent/ios`:

- `src/opencode`: protocol, schema and message updater vendored from opencode
  v1.18.33 (`pnpm vendor:opencode` re-syncs); `Opencode` derives a typed v2
  client per server from the server's own `HttpApi`.
- `src/outbox`: `Outbox` (lanes, workers, persistence, retry/hold), `Reachability`,
  `Folders`, background drain task, React bridge. Tested
  (`Outbox.test.ts`) and verified against the live server.
- `src/chat`: protocol-neutral view, v1/v2 adapters, live v2 transcript
  (session events + deltas). Chat sends through the outbox; tap a queued
  bubble to send it again or delete it.
- `src/sessions`: session lists from v2 (every project); protocol per session.
- Home/Repo: new sessions are v2 under a client id, through the outbox; a new
  workspace folder is made when sent.

Needs: the native build with expo-background-task, expo-task-manager,
expo-network and expo-crypto (2a1e8c62 or later).

Not yet: v1 sessions still wait for idle to send (v1 would inject a message
into the running turn); a new session's title shows its id until reopened.
