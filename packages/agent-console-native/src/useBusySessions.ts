/**
 * App-level "which sessions are running right now" set, for lists (Home, repo
 * screens) that show a per-session Stop only while the agent is actually working.
 *
 * A `Session` from the REST list carries no run state — that lives only on the
 * live event bus. So this taps the same `/global/event` stream the chat uses
 * (`client.global.event()`, via expo/fetch), but aggregates across every session
 * instead of one. `session.status` is the authoritative signal (`busy` at run
 * start, `idle` exactly once when the whole run — every turn/tool/wrap-up — is
 * done); part activity is folded in too so a run already in flight when the
 * stream connects registers as busy without waiting for the next status event.
 *
 * Gate it with `enabled` (e.g. only while the screen is focused) so it isn't
 * holding a second stream open behind the chat. On reconnect it re-derives from
 * the live events; there's no history seeding, so a session sitting idle is
 * simply absent from the set — which is exactly the "not running" answer.
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

export const useBusySessions = (client: OpencodeClient, enabled: boolean = true): ReadonlySet<string> => {
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    if (!enabled) {
      setBusy(new Set());
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const add = (id: string): void =>
      setBusy((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    const remove = (id: string): void =>
      setBusy((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
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
              if (status.type === "busy") add(status.sessionID);
              else remove(status.sessionID);
              continue;
            }
            const idle = idleSessionID(raw);
            if (idle !== undefined) {
              remove(idle);
              continue;
            }
            const active = activitySessionID(raw);
            if (active !== undefined) add(active);
          }
        } catch (error: unknown) {
          if (cancelled) return;
          errored = true;
          console.error("busy-sessions stream dropped, reconnecting", error);
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

  return busy;
};
