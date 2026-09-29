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
import { forgetCachedSession } from "./sessionCache";

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

/** Sessions moving into a list they were not in (archived, or brought back
 * by Undo): each one's card fades in when it next mounts, once. */
const returning = new Set<string>();

/** Whether this session's card is arriving in a list (and so fades in):
 * true once per move, for the card that mounts for it. */
export const takeReturning = (id: string): boolean => returning.delete(id);

/** Archive a session: gone from the lists, and from the phone's session
 * cache (archived sessions live on the server alone), now; saved behind. */
export const archiveSession = (apiBase: string, id: string): void => {
  const before = archivedIds;
  returning.add(id);
  set(new Set([...archivedIds, id]));
  void forgetCachedSession(id);
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
  returning.add(id);
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

/** The archive from the server, fresh: for the Archived page, which keeps
 * nothing on the phone. Also brings the lists up to date. */
export const fetchArchive = async (apiBase: string): Promise<Readonly<Record<string, number>>> => {
  const value = Schema.decodeUnknownSync(archived)(await request(`${base(apiBase)}/sessions/archived`));
  set(new Set(Object.keys(value)));
  return value;
};

/** Unarchive a session and say so, with Undo. */
export const unarchiveWithUndo = (apiBase: string, id: string): void => {
  unarchiveSession(apiBase, id);
  showToast({
    message: "Unarchived",
    action: {
      label: "Undo",
      run: () => archiveSession(apiBase, id),
    },
  });
};

/** A list without the archived sessions known now: what the phone's session
 * cache may keep. */
export const withoutArchived = <S extends { readonly id: string }>(sessions: ReadonlyArray<S>): ReadonlyArray<S> => unarchived(sessions, archivedIds);

/** Sessions that are not archived. */
export const unarchived = <S extends { readonly id: string }>(sessions: ReadonlyArray<S>, archivedSet: ReadonlySet<string>): ReadonlyArray<S> =>
  archivedSet.size === 0 ? sessions : sessions.filter((session) => !archivedSet.has(session.id));

// ── Muted ───────────────────────────────────────────────────────────────────
// Muted sessions send no notifications: the backend keeps the list (the
// notifier reads it before it sends), and the app marks them on their cards.

let mutedIds: ReadonlySet<string> = new Set();
let mutedVersion = 0;
const mutedListeners = new Set<() => void>();

const setMuted = (next: ReadonlySet<string>): void => {
  mutedIds = next;
  mutedVersion += 1;
  mutedListeners.forEach((listener) => listener());
};

/** Read the muted sessions from the backend (Home does). A failure leaves
 * what is known and is logged. */
export const loadMutedSessions = (apiBase: string): Promise<void> =>
  request(`${base(apiBase)}/sessions/muted`).then(
    (value) => setMuted(decode(value)),
    (error: unknown) => console.error("[session mute] reading the muted sessions failed", error),
  );

/** Mute a session, or unmute a muted one: shown at once, saved behind; a save
 * that fails puts it back and says why. */
export const toggleMute = (apiBase: string, id: string): void => {
  const before = mutedIds;
  const muting = !mutedIds.has(id);
  setMuted(muting ? new Set([...mutedIds, id]) : new Set([...mutedIds].filter((mutedId) => mutedId !== id)));
  post(apiBase, muting ? "/sessions/mute" : "/sessions/unmute", id).then(
    (value) => setMuted(decode(value)),
    (error: unknown) => {
      setMuted(before);
      Alert.alert(muting ? "Couldn’t mute" : "Couldn’t unmute", error instanceof Error ? error.message : String(error));
    },
  );
};

const subscribeMuted = (listener: () => void): (() => void) => {
  mutedListeners.add(listener);
  return () => mutedListeners.delete(listener);
};

/** The muted session ids, kept current. */
export const useMutedSessions = (): ReadonlySet<string> => {
  React.useSyncExternalStore(subscribeMuted, () => mutedVersion);
  return mutedIds;
};
