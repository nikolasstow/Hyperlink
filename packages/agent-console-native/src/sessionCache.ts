/**
 * On-device session-list cache — same "store whatever makes the app feel
 * faster" reasoning as repoScanCache.ts. Shows the last-known list
 * instantly on cold start (no blank/loading flash) while a fresh fetch
 * runs in the background.
 *
 * Archived sessions are never kept here: they live on the server alone, and
 * the Archived page loads them from it (sessionArchive.ts). Callers pass the
 * list without them.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionSummary } from "./sessions/sessionList";
import { Predicate } from "effect";

const STORAGE_KEY = "agent-console-native:sessions";

let inMemory: ReadonlyArray<SessionSummary> | undefined;

/** Whether a stored entry has what a session needs to be listed. The rest of
 * the SDK's session is carried as it was stored. */
const isSession = (value: unknown): value is SessionSummary =>
  Predicate.hasProperty(value, "id") &&
  Predicate.isString(value.id) &&
  Predicate.hasProperty(value, "title") &&
  Predicate.isString(value.title) &&
  Predicate.hasProperty(value, "directory") &&
  Predicate.isString(value.directory) &&
  Predicate.hasProperty(value, "time") &&
  Predicate.hasProperty(value.time, "updated") &&
  Predicate.isNumber(value.time.updated);

export const getCachedSessions = async (): Promise<ReadonlyArray<SessionSummary> | undefined> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.error("[session cache] the stored list is not a list; starting without it");
      return undefined;
    }
    const sessions = parsed.filter(isSession);
    if (sessions.length !== parsed.length) console.error(`[session cache] ${parsed.length - sessions.length} stored sessions were unreadable and are left out`);
    inMemory = sessions;
    return sessions;
  } catch (error: unknown) {
    // A cache that cannot be read only costs the instant first paint; the
    // fresh list still loads. Said, not hidden.
    console.error("[session cache] reading the stored list failed", error);
    return undefined;
  }
};

export const setCachedSessions = async (sessions: ReadonlyArray<SessionSummary>): Promise<void> => {
  inMemory = sessions;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error: unknown) {
    // Storage full or unavailable: the cache just won't survive a restart.
    console.error("[session cache] saving the list failed", error);
  }
};

/** Leave a session out of the cache (it was archived or deleted). */
export const forgetCachedSession = async (id: string): Promise<void> => {
  const cached = await getCachedSessions();
  if (cached !== undefined && cached.some((session) => session.id === id)) await setCachedSessions(cached.filter((session) => session.id !== id));
};

/** A session's title from the list already read this launch, if it is there. */
export const cachedSessionTitle = (id: string): string | undefined => inMemory?.find((session) => session.id === id)?.title;
