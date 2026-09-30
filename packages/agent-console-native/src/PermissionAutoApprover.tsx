/**
 * Answers permission asks for every session set to allow all (`full`, the
 * default; sessionPermissions.ts), app-wide, while the app is in the
 * foreground.
 *
 * It used to live in each chat screen's stream, which missed asks: a new
 * session asks within a moment of being created, before its chat has loaded
 * history and connected, and a session asking while its chat is not open had
 * no one listening. An ask missed is never sent again, so the run waited
 * forever. Here, every (re)connect first sweeps the asks already pending in
 * every session's directory, then answers new ones as they come.
 *
 * Sessions set to ask are left alone: their chat shows the prompt.
 *
 * @internal
 */
import * as React from "react";
import { AppState } from "react-native";
import { useAppContext } from "./AppContext";
import { asPendingPermission, getPermissionMode, replyToPermission, type PendingPermission } from "./sessionPermissions";

/** Wait before reconnecting after the stream drops, growing to this cap. */
const RETRY_MS = 1000;
const RETRY_MAX_MS = 15000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Approve an ask for a session on allow all; a failure is said, not dropped. */
const approve = (address: string, pending: PendingPermission): void => {
  if (getPermissionMode(pending.sessionID) !== "full") return;
  replyToPermission(address, pending, "once").catch((error: unknown) =>
    console.error(`[permissions] approving ${pending.requestID} (${pending.action}) failed`, error),
  );
};

/** The asks already pending in a directory (v1: opencode keeps them per
 * directory). */
const pendingIn = async (address: string, directory: string): Promise<ReadonlyArray<PendingPermission>> => {
  const response = await fetch(`${address}/permission?directory=${encodeURIComponent(directory)}`);
  if (!response.ok) throw new Error(`listing permissions in ${directory}: HTTP ${response.status} ${await response.text()}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error(`listing permissions in ${directory}: not a list`);
  return body.flatMap((ask): ReadonlyArray<PendingPermission> => {
    // A listed ask has the same fields as the event's properties.
    const pending = asPendingPermission({ type: "permission.asked", properties: ask }, directory);
    return pending === undefined ? [] : [pending];
  });
};

/** Mounted once, inside the app's context. */
export const PermissionAutoApprover = (): null => {
  const { client, address } = useAppContext();
  const [foreground, setForeground] = React.useState(AppState.currentState !== "background");

  React.useEffect(() => {
    // Only "background" is a real background; "inactive" flaps constantly.
    const subscription = AppState.addEventListener("change", (state) => setForeground(state !== "background"));
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    if (!foreground) return undefined;
    const controller = new AbortController();
    let cancelled = false;

    /** Approve every ask already pending, in every session's directory. */
    const sweep = async (): Promise<void> => {
      const { data: sessions } = await client.session.list();
      const directories = new Set((sessions ?? []).map((session) => session.directory));
      for (const directory of directories) {
        if (cancelled) return;
        for (const pending of await pendingIn(address, directory)) approve(address, pending);
      }
    };

    const run = async (): Promise<void> => {
      let wait = RETRY_MS;
      while (!cancelled) {
        try {
          const { stream } = await client.global.event({ signal: controller.signal });
          // Connected: what was asked while no one listened, then what comes.
          sweep().catch((error: unknown) => console.error("[permissions] sweeping pending asks failed", error));
          wait = RETRY_MS;
          for await (const item of stream) {
            if (cancelled) return;
            const directory = isRecord(item) && typeof item.directory === "string" ? item.directory : undefined;
            const pending = directory === undefined ? undefined : asPendingPermission(item.payload, directory);
            if (pending !== undefined) approve(address, pending);
          }
        } catch (error: unknown) {
          if (cancelled) return;
          console.warn("[permissions] the event stream dropped; reconnecting", error);
        }
        await new Promise((resolve) => setTimeout(resolve, wait));
        wait = Math.min(wait * 2, RETRY_MAX_MS);
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [client, address, foreground]);

  return null;
};
