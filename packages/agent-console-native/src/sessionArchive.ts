/**
 * Archived sessions, as the app sees them: the backend's archive
 * (`/sessions/archived`, sessions/archive.ts on the server) kept here so every
 * list leaves archived sessions out. opencode has no archive of its own.
 *
 * Archiving hides a session at once and then saves it; a save that fails puts
 * it back and says why. The archive page (to come) lists them.
 *
 * @internal
 */
import { Schema } from "effect";
import * as React from "react";
import { Alert } from "react-native";
import { showToast } from "./AppToast";
import { base, request } from "./extensionsClient";

const archived = Schema.Record(Schema.String, Schema.Number);

let archivedIds: ReadonlySet<string> = new Set();
let version = 0;
const listeners = new Set<() => void>();

const set = (next: ReadonlySet<string>): void => {
  archivedIds = next;
  version += 1;
  listeners.forEach((listener) => listener());
};

const decode = (value: unknown): ReadonlySet<string> => new Set(Object.keys(Schema.decodeUnknownSync(archived)(value)));

/** Read the archive from the backend (Home does, as it loads sessions). A
 * failure leaves what is known and is logged; the lists still work. */
export const loadArchivedSessions = (apiBase: string): Promise<void> =>
  request(`${base(apiBase)}/sessions/archived`).then(
    (value) => set(decode(value)),
    (error: unknown) => console.error("[session archive] reading the archive failed", error),
  );

const post = (apiBase: string, path: string, id: string) =>
  request(`${base(apiBase)}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });

/** Archive a session: gone from the lists now, saved behind. */
export const archiveSession = (apiBase: string, id: string): void => {
  const before = archivedIds;
  set(new Set([...archivedIds, id]));
  post(apiBase, "/sessions/archive", id).then(
    (value) => set(decode(value)),
    (error: unknown) => {
      set(before);
      Alert.alert("Couldn’t archive", error instanceof Error ? error.message : String(error));
    },
  );
};

/** Archive a session and say so, with Undo (the toast outlives the row). */
export const archiveWithUndo = (apiBase: string, id: string): void => {
  archiveSession(apiBase, id);
  showToast({
    message: "Archived",
    action: {
      label: "Undo",
      run: () => unarchiveSession(apiBase, id),
    },
  });
};

/** Take a session out of the archive (Undo, and the archive page to come). */
export const unarchiveSession = (apiBase: string, id: string): void => {
  const before = archivedIds;
  set(new Set([...archivedIds].filter((archivedId) => archivedId !== id)));
  post(apiBase, "/sessions/unarchive", id).then(
    (value) => set(decode(value)),
    (error: unknown) => {
      set(before);
      Alert.alert("Couldn’t unarchive", error instanceof Error ? error.message : String(error));
    },
  );
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The archived session ids, kept current. */
export const useArchivedSessions = (): ReadonlySet<string> => {
  React.useSyncExternalStore(subscribe, () => version);
  return archivedIds;
};

/** Sessions that are not archived. */
export const unarchived = <S extends { readonly id: string }>(sessions: ReadonlyArray<S>, archivedSet: ReadonlySet<string>): ReadonlyArray<S> =>
  archivedSet.size === 0 ? sessions : sessions.filter((session) => !archivedSet.has(session.id));
