/**
 * Transcript for one session — ported from
 * packages/agent-console/src/opencode/useSessionStream.ts, adapted to take
 * `client` as a parameter (see repoScan.ts for why: no module-level
 * singleton client here). Loads existing history (`session.messages`) on
 * mount, then subscribes to the server's real-time event bus
 * (`client.global.event()`, hitting `/global/event`) for anything new —
 * this is the reason client.ts wires in `expo/fetch`: RN's default fetch
 * can't stream a response body the way this async-iterable stream needs.
 *
 * IMPORTANT: this is `/global/event`, not `client.event.subscribe()`
 * (`/event`). Confirmed by hand with raw curl, independent of this app —
 * `/event` only ever emits `server.connected`/`server.heartbeat`, even
 * while prompts are actively being processed and replied to server-side.
 * `/global/event` is the one that actually broadcasts
 * `message.updated`/`message.part.updated`/`session.idle`/etc. — wrapped
 * as `{ directory, payload: Event }`, so every event needs `.payload`
 * unwrapped before it matches the same `Event` union `/event` was
 * (incorrectly) assumed to yield directly.
 *
 * Cached (transcriptCache.ts) per session id: re-opening a session paints
 * instantly from the cached transcript while history/live reconnect happen
 * in the background.
 *
 * If the SSE connection drops it reconnects with exponential backoff
 * instead of going silently dead — refetches history on each reconnect
 * too, self-healing anything missed while down.
 *
 * Role comes from `message.updated` events (`info.role`), not from
 * guessing which message ID the client just sent — see the web version's
 * own history for why a client-supplied messageID broke the server's
 * turn-completion tracking. Letting the server assign every ID and reading
 * role back off its own events avoids that.
 *
 * @internal
 */
import * as React from "react";
import type { Part, ReasoningPart, TextPart, ToolPart } from "@opencode-ai/sdk";
import type { OpencodeClient } from "./client";
import { isPartDeltaEvent, withPartDelta } from "./partDelta";
import {
  asPendingPermission,
  getPermissionMode,
  replyToPermission,
  type PendingPermission,
  type PermissionReply,
} from "./sessionPermissions";
import { transcriptCache } from "./transcriptCache";

export type RenderablePart = TextPart | ToolPart | ReasoningPart;

export type TranscriptMessage = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly parts: ReadonlyMap<string, RenderablePart>;
  /** Present on assistant messages once the server reports them. */
  readonly providerID?: string;
  readonly modelID?: string;
  /** Assistant runs only. `completed` is absent while the run is in flight —
   * it is the server's own record of whether work is still happening, which
   * survives a dropped stream in a way a local `busy` flag cannot. */
  readonly time?: { readonly created: number; readonly completed?: number };
};

export type Transcript = {
  readonly messages: ReadonlyMap<string, TranscriptMessage>;
  readonly order: ReadonlyArray<string>;
  readonly busy: boolean;
};

export const EMPTY: Transcript = { messages: new Map(), order: [], busy: false };

/**
 * Whether the newest assistant run is still in flight, according to the
 * server. A local `busy` flag only clears on a live `session.idle`, and the
 * stream is deliberately dropped while the app is backgrounded — so a run
 * that finished out of view left the indicator spinning forever, and the
 * cache persisted it across launches.
 */
export const busyFromHistory = (transcript: Transcript): boolean => {
  for (let i = transcript.order.length - 1; i >= 0; i -= 1) {
    const message = transcript.messages.get(transcript.order[i]);
    if (message === undefined || message.role !== "assistant") continue;
    return message.time !== undefined && message.time.completed === undefined;
  }
  return false;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The authoritative run-level busy signal. opencode emits `session.status` with
 * `{ type: "busy" }` when a run starts and `{ type: "idle" }` exactly once when
 * the WHOLE run is done — every turn, tool call and wrap-up included. This is
 * the correct completion signal; per-message `time.completed` is not, because a
 * run is many assistant messages (each tool-use turn is its own message that
 * "completes" mid-run). `session.status` is not in the pinned SDK's Event union,
 * so it's read defensively off the raw event.
 */
const readSessionStatus = (raw: unknown): { readonly sessionID: string; readonly type: string } | undefined => {
  if (!isRecord(raw) || raw.type !== "session.status") return undefined;
  const props = isRecord(raw.properties) ? raw.properties : undefined;
  if (props === undefined) return undefined;
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
  const status = isRecord(props.status) ? props.status : undefined;
  const type = status !== undefined && typeof status.type === "string" ? status.type : undefined;
  if (sessionID === undefined || type === undefined) return undefined;
  return { sessionID, type };
};

/** When the in-flight run started, for the elapsed clock. Taken from the
 * server's own timestamp so reopening the chat does not restart it. */
export const runStartedAt = (transcript: Transcript): number | undefined => {
  for (let i = transcript.order.length - 1; i >= 0; i -= 1) {
    const message = transcript.messages.get(transcript.order[i]);
    if (message === undefined || message.role !== "assistant") continue;
    if (message.time === undefined || message.time.completed !== undefined) return undefined;
    // opencode reports epoch milliseconds; a value small enough to be seconds
    // would put the clock decades out.
    return message.time.created < 1e12 ? message.time.created * 1000 : message.time.created;
  }
  return undefined;
};
const MAX_RECONNECT_DELAY_MS = 10_000;
const LOCAL_ID_PREFIX = "local-";

export const isRenderablePart = (part: Part): part is RenderablePart =>
  part.type === "text" || part.type === "tool" || part.type === "reasoning";

export const withRole = (
  transcript: Transcript,
  messageID: string,
  role: "user" | "assistant",
  model?: { readonly providerID: string; readonly modelID: string },
  time?: { readonly created: number; readonly completed?: number },
): Transcript => {
  const existing = transcript.messages.get(messageID);
  const messages = new Map(transcript.messages);
  messages.set(messageID, {
    id: messageID,
    role,
    parts: existing?.parts ?? new Map(),
    providerID: model?.providerID ?? existing?.providerID,
    modelID: model?.modelID ?? existing?.modelID,
    time: time ?? existing?.time,
  });
  const order = existing === undefined ? [...transcript.order, messageID] : transcript.order;
  return { ...transcript, messages, order };
};

export const withPart = (transcript: Transcript, part: RenderablePart): Transcript => {
  const existing = transcript.messages.get(part.messageID);
  const role = existing?.role ?? "assistant";
  const parts = new Map(existing?.parts ?? []);
  parts.set(part.id, part);
  const messages = new Map(transcript.messages);
  messages.set(part.messageID, {
    id: part.messageID,
    role,
    parts,
    providerID: existing?.providerID,
    modelID: existing?.modelID,
  });
  const order = existing === undefined ? [...transcript.order, part.messageID] : transcript.order;
  return { ...transcript, messages, order };
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const useSessionStream = (
  client: OpencodeClient,
  sessionID: string | undefined,
  /** Base URL for the permission endpoints the pinned SDK does not expose. */
  address: string,
  /** Whether to hold a live connection. False tears the stream down — see
   * useStreamEnabled for why a backgrounded socket is worse than none. */
  enabled: boolean,
): {
  readonly transcript: Transcript;
  /** A permission the server is waiting on, when this session asks rather
   * than auto-approving. Null while nothing is pending. */
  readonly pendingPermission: PendingPermission | undefined;
  readonly replyPermission: (reply: PermissionReply) => Promise<void>;
  readonly markBusy: () => void;
  readonly clearBusy: () => void;
  /** Adds the just-sent text to the transcript immediately, under a local
   * placeholder id, rather than waiting for it to round-trip back as a
   * server-confirmed `message.updated`/`message.part.updated` event pair —
   * standard chat-app optimistic echo. Reconciled automatically inside
   * `apply`: the composer disables itself while a send is in flight, so at
   * most one placeholder is ever pending, and it's dropped the moment any
   * *other* new user message shows up (the real, server-confirmed one). */
  readonly sendOptimistic: (text: string) => void;
  /** Whether the `/global/event` stream is actually connected right now —
   * real state from the same reconnect loop `run` below already runs, not
   * a synthesized/always-on badge. False until the first successful
   * connect, and while a reconnect attempt is in flight after a drop. */
  readonly connected: boolean;
  /** Force a full refresh: tears the live connection down and re-establishes
   * it, reloading history from the server. For a manual "Refresh" action when a
   * session looks out of sync. */
  readonly refresh: () => void;
} => {
  const [transcript, setTranscript] = React.useState<Transcript>(() => (sessionID !== undefined ? (transcriptCache.get(sessionID) ?? EMPTY) : EMPTY));
  const [connected, setConnected] = React.useState(false);
  const [pendingPermission, setPendingPermission] = React.useState<PendingPermission | undefined>(undefined);
  // Bumped by `refresh()`; part of the stream effect's deps, so incrementing it
  // tears the connection down and re-runs it (a fresh history load included).
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const refresh = React.useCallback(() => setRefreshNonce((n) => n + 1), []);

  const replyPermission = React.useCallback(
    async (reply: PermissionReply): Promise<void> => {
      if (pendingPermission === undefined) return;
      await replyToPermission(address, pendingPermission, reply);
      setPendingPermission(undefined);
    },
    [address, pendingPermission],
  );
  const currentRef = React.useRef<Transcript>(transcript);
  const sessionIdRef = React.useRef(sessionID);
  sessionIdRef.current = sessionID;
  const pendingOptimisticIdRef = React.useRef<string | undefined>(undefined);
  // True while THIS screen is running a prompt (markBusy → clearBusy around an
  // awaited `session.prompt()`). While set, the prompt's completion is the
  // authoritative busy signal, so the event stream's `session.idle` is ignored —
  // the stream reconnects constantly (expo/fetch closes it every few seconds)
  // and opencode replays recent events on each re-subscribe, so a *stale*
  // `session.idle` can arrive mid-run and would otherwise end the run early. */
  const runInFlightRef = React.useRef(false);

  const apply = React.useCallback((updater: (t: Transcript) => Transcript): void => {
    const previous = currentRef.current;
    let next = updater(previous);

    const pendingId = pendingOptimisticIdRef.current;
    if (pendingId !== undefined) {
      const realUserMessageArrived = Array.from(next.messages.values()).some(
        (m) => m.role === "user" && m.id !== pendingId && !previous.messages.has(m.id),
      );
      if (realUserMessageArrived) {
        const messages = new Map(next.messages);
        messages.delete(pendingId);
        next = { ...next, messages, order: next.order.filter((id) => id !== pendingId) };
        pendingOptimisticIdRef.current = undefined;
      }
    }

    currentRef.current = next;
    const id = sessionIdRef.current;
    if (id !== undefined) transcriptCache.set(id, next);
    setTranscript(next);
  }, []);

  const sendOptimistic = React.useCallback(
    (text: string) => {
      const id = sessionIdRef.current;
      if (id === undefined) return;
      const tempId = `${LOCAL_ID_PREFIX}${Math.random().toString(36).slice(2)}`;
      pendingOptimisticIdRef.current = tempId;
      const part: TextPart = { id: `${tempId}-part`, sessionID: id, messageID: tempId, type: "text", text };
      apply((t) => withPart(withRole(t, tempId, "user"), part));
    },
    [apply],
  );

  // [LA3] temporary — identify which effect dep flaps (causes the stream storm).
  const depsRef = React.useRef<{ sessionID: unknown; apply: unknown; client: unknown; enabled: unknown; address: unknown; refreshNonce: unknown } | undefined>(undefined);
  const depsNow = { sessionID, apply, client, enabled, address, refreshNonce };
  if (depsRef.current !== undefined) {
    const changed = (Object.keys(depsNow) as Array<keyof typeof depsNow>).filter((k) => depsNow[k] !== depsRef.current?.[k]);
    if (changed.length > 0) console.log("[LA3] stream deps changed:", changed.join(","));
  }
  depsRef.current = depsNow;

  React.useEffect(() => {
    setConnected(false);
    if (sessionID === undefined || !enabled) {
      currentRef.current = EMPTY;
      setTranscript(EMPTY);
      return;
    }
    const seeded = transcriptCache.get(sessionID) ?? EMPTY;
    currentRef.current = seeded;
    setTranscript(seeded);

    const controller = new AbortController();
    let cancelled = false;
    // Only the FIRST load (opening / returning to the session) reconciles busy
    // from history. A later load is a stream RECONNECT — the SSE can drop and
    // re-open repeatedly mid-run — and must NOT touch busy, or every reconnect
    // would clear it (history's per-message timing reads as "not busy" between a
    // run's turns) and end the Live Activity mid-run. Busy is otherwise driven
    // by the live run-level `session.status`.
    let firstLoad = true;

    const loadHistory = async (): Promise<void> => {
      const isFirst = firstLoad;
      firstLoad = false;
      const { data: history } = await client.session.messages({ path: { id: sessionID } });
      if (cancelled) return;
      apply((t) => {
        let next = t;
        for (const { info, parts } of history ?? []) {
          next = withRole(
            next,
            info.id,
            info.role,
            info.role === "assistant"
              ? { providerID: info.providerID, modelID: info.modelID }
              : undefined,
            info.role === "assistant" ? info.time : undefined,
          );
          for (const part of parts) {
            if (isRenderablePart(part)) next = withPart(next, part);
          }
        }
        // `withRole`/`withPart` preserve `busy`, so `next` already carries the
        // live busy — leave it, EXCEPT on a genuine first load with no local run
        // in flight, where it's reconciled from history. Never touch busy while
        // this screen is running a prompt: `prompt()` owns completion, and the
        // stream effect can re-run (a flapping dep) mid-send, which would
        // otherwise reset `firstLoad` and clear busy from history before the
        // assistant message exists — ending the Live Activity early.
        return isFirst && !runInFlightRef.current ? { ...next, busy: busyFromHistory(next) } : next;
      });
    };

    const run = async (): Promise<void> => {
      let attempt = 0;
      while (!cancelled) {
        let errored = false;
        try {
          await loadHistory();
          const { stream } = await client.global.event({ signal: controller.signal });
          attempt = 0;
          setConnected(true);
          for await (const { payload: event } of stream) {
            if (cancelled) return;
            // Widened deliberately: `message.part.delta` is not in the pinned
            // v1 SDK's Event union, so it cannot be narrowed off `event.type`.
            // See partDelta.ts.
            const raw: unknown = event;
            // Permission asks pause the run until answered. In `full` mode
            // that reply is automatic, so an agent never stalls waiting on a
            // UI this app did not used to have. A failed auto-reply falls
            // through to the prompt rather than leaving the run wedged.
            const asked = asPendingPermission(raw);
            const status = readSessionStatus(raw);
            if (asked !== undefined && asked.sessionID === sessionID) {
              if (getPermissionMode(sessionID) === "full") {
                void replyToPermission(address, asked, "once").catch(() => setPendingPermission(asked));
              } else {
                setPendingPermission(asked);
              }
            } else if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
              // opencode's true "run done" signal for a run this screen did NOT
              // itself start (e.g. returning to an in-flight session). For a
              // local send, the awaited `prompt()` owns completion and this is
              // ignored — a reconnect can replay a stale idle mid-run.
              if (!runInFlightRef.current) apply((t) => ({ ...t, busy: false }));
            } else if (status !== undefined && status.sessionID === sessionID) {
              // Keeps busy true while a run is in flight (and re-affirms it when
              // returning to an in-flight session). Its `idle` is deliberately
              // ignored — see session.idle above.
              if (status.type === "busy") apply((t) => ({ ...t, busy: true }));
            } else if (isPartDeltaEvent(raw) && raw.properties.sessionID === sessionID) {
              const deltaEvent = raw;
              apply((t) => withPartDelta(t, deltaEvent));
            } else if (event.type === "message.updated" && event.properties.info.sessionID === sessionID) {
              const info = event.properties.info;
              // Capture role, model and the server's run timing (used when
              // returning to a session — see loadHistory). Busy is NOT touched
              // here: a run has many assistant messages and each one "completes"
              // mid-run, so message-level timing is the wrong signal — busy is
              // driven by session.status above.
              apply((t) =>
                withRole(
                  t,
                  info.id,
                  info.role,
                  info.role === "assistant"
                    ? { providerID: info.providerID, modelID: info.modelID }
                    : undefined,
                  info.role === "assistant" ? info.time : undefined,
                ),
              );
            } else if (event.type === "message.part.updated" && isRenderablePart(event.properties.part) && event.properties.part.sessionID === sessionID) {
              const part = event.properties.part;
              apply((t) => withPart(t, part));
            }
          }
        } catch (error: unknown) {
          if (cancelled) return;
          errored = true;
          setConnected(false);
          console.error("session event stream dropped, reconnecting", error);
        }
        if (cancelled) return;
        // expo/fetch closes the streaming response body every few seconds even
        // though opencode keeps it open, so the stream "completes" normally and
        // we must re-subscribe. Do that immediately — a backoff here would leave
        // a gap in which live events (a `session.idle`, deltas) are missed.
        // Backoff applies only to a real error, to avoid hammering a down server.
        if (errored) {
          attempt += 1;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sessionID, apply, client, enabled, address, refreshNonce]);

  const markBusy = React.useCallback(() => {
    runInFlightRef.current = true;
    apply((t) => ({ ...t, busy: true }));
  }, [apply]);

  const clearBusy = React.useCallback(() => {
    runInFlightRef.current = false;
    apply((t) => ({ ...t, busy: false }));
  }, [apply]);

  return { transcript, pendingPermission, replyPermission, markBusy, clearBusy, sendOptimistic, connected, refresh };
};
