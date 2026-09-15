/**
 * App-level live session activity, for lists (Home, repo screens): which
 * sessions are running right now, and the latest moment each session did
 * anything. Both feed off the same `/global/event` stream the chat uses
 * (`client.global.event()`, via expo/fetch), aggregated across every session.
 *
 *   - `busy`: `session.status` is the authoritative signal (`busy` at run start,
 *     `idle` exactly once when the whole run is done); part activity is folded in
 *     so a run already in flight when the stream connects still registers.
 *   - `activityAt`: the latest activity timestamp per session, so an unread
 *     indicator updates the instant a message lands rather than on the next
 *     refresh. `session.updated` carries the server's own `time.updated`; every
 *     other activity event stamps the local clock.
 *
 * Gate with `enabled` (e.g. only while the screen is focused) so it isn't holding
 * a second stream open behind the chat. There's no history seeding: a session
 * with no live event is simply absent (not busy; no live activity beyond what the
 * REST list already reported), which is the correct answer for both.
 *
 * @internal
 */
import * as React from "react";
import type { OpencodeClient } from "./client";
import { isPartDeltaEvent } from "./partDelta";
import { readSessionStatus } from "./useSessionStream";

const MAX_RECONNECT_DELAY_MS = 10_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** The sessionID an activity event belongs to, if it carries one. */
const activitySessionID = (raw: unknown): string | undefined => {
  if (isPartDeltaEvent(raw)) return raw.properties.sessionID;
  if (!isRecord(raw) || raw.type !== "message.part.updated") return undefined;
  const props = isRecord(raw.properties) ? raw.properties : undefined;
  const part = props !== undefined && isRecord(props.part) ? props.part : undefined;
  return part !== undefined && typeof part.sessionID === "string" ? part.sessionID : undefined;
};

/** The sessionID of a `session.idle` event, if this is one. */
const idleSessionID = (raw: unknown): string | undefined => {
  if (!isRecord(raw) || raw.type !== "session.idle") return undefined;
  const props = isRecord(raw.properties) ? raw.properties : undefined;
  return props !== undefined && typeof props.sessionID === "string" ? props.sessionID : undefined;
};

/** A `session.updated` event's id and server-reported update time, if this is one. */
const sessionUpdated = (raw: unknown): { readonly id: string; readonly updated: number } | undefined => {
  if (!isRecord(raw) || raw.type !== "session.updated") return undefined;
  const props = isRecord(raw.properties) ? raw.properties : undefined;
  const info = props !== undefined && isRecord(props.info) ? props.info : undefined;
  if (info === undefined || typeof info.id !== "string") return undefined;
  const time = isRecord(info.time) ? info.time : undefined;
  const updated = time !== undefined && typeof time.updated === "number" ? time.updated : Date.now();
  return { id: info.id, updated };
};

export type SessionActivity = {
  readonly busy: ReadonlySet<string>;
  readonly activityAt: ReadonlyMap<string, number>;
};

const EMPTY: SessionActivity = { busy: new Set(), activityAt: new Map() };

export const useSessionActivity = (client: OpencodeClient, enabled: boolean = true): SessionActivity => {
  const [state, setState] = React.useState<SessionActivity>(EMPTY);

  React.useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const setBusy = (id: string, on: boolean): void =>
      setState((prev) => {
        if (prev.busy.has(id) === on) return prev;
        const busy = new Set(prev.busy);
        if (on) busy.add(id);
        else busy.delete(id);
        return { busy, activityAt: prev.activityAt };
      });
    const bump = (id: string, at: number): void =>
      setState((prev) => {
        if ((prev.activityAt.get(id) ?? 0) >= at) return prev;
        const activityAt = new Map(prev.activityAt);
        activityAt.set(id, at);
        return { busy: prev.busy, activityAt };
      });

    const run = async (): Promise<void> => {
      let attempt = 0;
      while (!cancelled) {
        let errored = false;
        try {
          const { stream } = await client.global.event({ signal: controller.signal });
          attempt = 0;
          for await (const { payload: event } of stream) {
            if (cancelled) return;
            const raw: unknown = event;

            const status = readSessionStatus(raw);
            if (status !== undefined) {
              setBusy(status.sessionID, status.type === "busy");
              bump(status.sessionID, Date.now());
              continue;
            }
            const idle = idleSessionID(raw);
            if (idle !== undefined) {
              setBusy(idle, false);
              bump(idle, Date.now());
              continue;
            }
            const updated = sessionUpdated(raw);
            if (updated !== undefined) {
              bump(updated.id, updated.updated);
              continue;
            }
            const active = activitySessionID(raw);
            if (active !== undefined) {
              setBusy(active, true);
              bump(active, Date.now());
            }
          }
        } catch (error: unknown) {
          if (cancelled) return;
          errored = true;
          console.error("session-activity stream dropped, reconnecting", error);
        }
        if (cancelled) return;
        // expo/fetch closes the streaming body every few seconds, so a clean end
        // just means re-subscribe immediately; back off only on a real error.
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
  }, [client, enabled]);

  return state;
};
