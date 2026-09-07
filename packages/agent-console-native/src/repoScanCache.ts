/**
 * Caches the repoScan.ts result on-device (AsyncStorage) so it survives an
 * app restart, with staleness-based auto-refresh — same shape as the web
 * app's repoScanCache.ts, ported for AsyncStorage's async reads (no
 * synchronous cache read possible here, unlike localStorage).
 *
 * Home Repos and the composer picker share this scan for **repos**.
 * Non-git "Workspaces" in the picker are session-derived on HomeScreen
 * (directories that have sessions but aren't known repos) — not a second
 * filesystem walk.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { runFs } from "./effect/runtime";
import { type ScannedRepo, scanRepos } from "./repoScan";

const STORAGE_KEY = "agent-console-native:repoScan";
const LAST_SCAN_KEY = "agent-console-native:lastScanAt";

/** Bump whenever repoScan.ts's algorithm changes — see the web app's own
 * repoScanCache.ts for why this matters: an already-open client with a
 * scan cached under an older, buggier algorithm must not keep rendering it
 * past its staleness timer. */
const SCAN_VERSION = 4;

const STALE_AFTER_MS = 30 * 60 * 1000;

type Persisted = { readonly version: number; readonly repos: ReadonlyArray<ScannedRepo> };

let inMemory: ReadonlyArray<ScannedRepo> | undefined;
let inFlight: Promise<ReadonlyArray<ScannedRepo>> | undefined;

export const getCachedRepos = async (): Promise<ReadonlyArray<ScannedRepo> | undefined> => {
  if (inMemory !== undefined) return inMemory;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed.version !== SCAN_VERSION || parsed.repos === undefined) return undefined;
    inMemory = parsed.repos;
    return parsed.repos;
  } catch {
    return undefined;
  }
};

export const getLastScanAt = async (): Promise<number | undefined> => {
  const raw = await AsyncStorage.getItem(LAST_SCAN_KEY);
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const isStale = async (): Promise<boolean> => {
  const at = await getLastScanAt();
  return at === undefined || Date.now() - at > STALE_AFTER_MS;
};

export const rescan = (backend: string, rootDir: string): Promise<ReadonlyArray<ScannedRepo>> => {
  if (inFlight !== undefined) return inFlight;
  // The backend expands a leading `~` itself, so `rootDir` is passed straight
  // through — no `$HOME` round-trip. `runFs` runs the Effect scan and hands its
  // result back as a Promise for the React callers.
  inFlight = runFs(scanRepos(backend, rootDir))
    .then(async (repos) => {
      inMemory = repos;
      const toStore: Persisted = { version: SCAN_VERSION, repos };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      await AsyncStorage.setItem(LAST_SCAN_KEY, String(Date.now()));
      return repos;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
};

/** Cached scan (same source Home Repos use). */
export const readWorkspace = async (): Promise<ReadonlyArray<ScannedRepo> | undefined> =>
  getCachedRepos();

/** Fresh scan — single source for Home + composer picker repos. */
export const refreshWorkspace = async (
  backend: string,
  rootDir: string,
): Promise<ReadonlyArray<ScannedRepo>> => rescan(backend, rootDir);
