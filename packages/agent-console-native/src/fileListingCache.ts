/**
 * App-level cache of directory listings, shared across every explorer screen so
 * a folder isn't re-fetched each time it's opened — drilling in, backing out and
 * re-entering, or re-expanding all paint instantly from here. Survives screen
 * unmount (module-level, like sessionCache/repoScanCache).
 *
 * `prefetchTree` warms a whole subtree in the background — a throttled,
 * breadth-first crawl `DEPTH` levels down from a directory, so opening folders
 * stays instant well ahead of the cursor rather than one level at a time. It
 * skips the dirs that would explode the crawl (node_modules, .git, build output,
 * …) — those still load on demand if you actually open them — and is bounded by
 * a concurrency limit and a hard ceiling on total directories.
 *
 * @internal
 */
import { runFs } from "./effect/runtime";
import { fsList, type FsEntry } from "./fsClient";

const cache = new Map<string, ReadonlyArray<FsEntry>>();
const inFlight = new Set<string>();

/** Levels to crawl below a directory when prefetching. Each newly-loaded
 * directory re-arms the crawl from itself, so browsing keeps the frontier ahead. */
const DEPTH = 6;
/** Background fetches in flight at once — enough to warm quickly, few enough not
 * to starve the foreground load or hammer the backend. */
const MAX_CONCURRENCY = 8;
/** Hard ceiling on directories a crawl will ever enqueue, so a pathological tree
 * can't run away. On-demand loading still works past it. */
const MAX_DIRS = 6000;

/** Directories never worth prefetching — huge and rarely browsed. They still
 * load on demand when actually opened. */
const SKIP = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".expo",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  "Pods",
  "DerivedData",
]);

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

type Job = { readonly backend: string; readonly path: string; readonly depth: number };
const queue: Job[] = [];
const queued = new Set<string>();
let active = 0;

export const getCachedListing = (path: string): ReadonlyArray<FsEntry> | undefined => cache.get(path);

export const setCachedListing = (path: string, entries: ReadonlyArray<FsEntry>): void => {
  cache.set(path, entries);
};

const recurse = (backend: string, entries: ReadonlyArray<FsEntry>, parent: string, depth: number): void => {
  if (depth <= 0) return;
  for (const entry of entries) {
    if (entry.type === "directory" && !SKIP.has(entry.name)) enqueue(backend, joinPath(parent, entry.name), depth - 1);
  }
};

const pump = (): void => {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    if (job === undefined) return;
    active += 1;
    const done = (): void => {
      active -= 1;
      pump();
    };
    const cached = cache.get(job.path);
    if (cached !== undefined) {
      recurse(job.backend, cached, job.path, job.depth);
      done();
      continue;
    }
    if (inFlight.has(job.path)) {
      done();
      continue;
    }
    inFlight.add(job.path);
    void runFs(fsList(job.backend, job.path))
      .then((entries) => {
        cache.set(job.path, entries);
        recurse(job.backend, entries, job.path, job.depth);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(job.path);
        done();
      });
  }
};

const enqueue = (backend: string, path: string, depth: number): void => {
  if (queued.has(path) || queued.size >= MAX_DIRS) return;
  queued.add(path);
  queue.push({ backend, path, depth });
  pump();
};

/** Warm the subtree under `path` in the background, `DEPTH` levels deep. Deduped
 * and throttled; best-effort (failures are left uncached for the real open). */
export const prefetchTree = (backend: string, path: string): void => {
  const cached = cache.get(path);
  if (cached !== undefined) {
    // Already have this directory — just extend the frontier below it.
    recurse(backend, cached, path, DEPTH);
    return;
  }
  enqueue(backend, path, DEPTH);
};
