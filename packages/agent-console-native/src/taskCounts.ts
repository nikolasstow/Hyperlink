/**
 * How many open tasks a repo has, by kind. A task is a GitHub issue
 * (docs/handoffs/double-agent-repo-screen-and-plugin-system.md §25), read through
 * the backend's `/github` proxy (githubPlugin.ts), so the phone never holds a
 * GitHub credential.
 *
 * A task's kind is its GitHub issue type when the repo uses them; else the
 * GitHub default labels say (`bug` → Bug, `enhancement` → Feature); else it
 * is a Task.
 *
 * The counts are kept on the phone and loaded as the app starts, so a page
 * shows them the instant it renders; Home refreshes every repo's in the
 * background (`prefetchTaskCounts`), and a page showing one refreshes it.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Schema } from "effect";
import * as React from "react";
import { base, request } from "./extensionsClient";
import type { GitHubRepo, ScannedRepo } from "./repoScan";

const Issue = Schema.Struct({
  number: Schema.Number,
  /** Present on pull requests, which the issues list includes. */
  pull_request: Schema.optional(Schema.Unknown),
  type: Schema.optional(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  labels: Schema.Array(Schema.Struct({ name: Schema.String })),
});
type Issue = typeof Issue.Type;
const Issues = Schema.Array(Issue);

const TaskCountSchema = Schema.Struct({
  kind: Schema.String,
  count: Schema.Number,
});

/** One kind of task and how many are open. */
export interface TaskCount {
  readonly kind: string;
  readonly count: number;
}

/** The default labels GitHub gives every repo, as kinds. */
const KIND_BY_LABEL: Readonly<Record<string, string>> = {
  bug: "Bug",
  enhancement: "Feature",
};
const DEFAULT_KIND = "Task";
/** The kinds always shown, in this order, even at zero; any other kind (a
 * GitHub issue type of the repo's own) follows them. */
export const KINDS: ReadonlyArray<string> = ["Bug", "Feature", DEFAULT_KIND];

export const kindOf = (issue: Issue): string =>
  issue.type?.name ?? issue.labels.map((label) => KIND_BY_LABEL[label.name.toLowerCase()]).find((kind) => kind !== undefined) ?? DEFAULT_KIND;

/** Open issues (not pull requests) counted by kind: every kind in `KINDS`,
 * zero or not, then any others the repo has, most first. */
export const countByKind = (issues: ReadonlyArray<Issue>): ReadonlyArray<TaskCount> => {
  const counts = new Map<string, number>(KINDS.map((kind) => [kind, 0]));
  for (const issue of issues) {
    if (issue.pull_request !== undefined) continue;
    const kind = kindOf(issue);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const all = [...counts].map(([kind, count]): TaskCount => ({
    kind,
    count,
  }));
  const others = all.filter((count) => !KINDS.includes(count.kind)).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return [...all.filter((count) => KINDS.includes(count.kind)), ...others];
};

/** The repo's open tasks by kind (the first 100 open issues). */
const fetchTaskCounts = async (apiBase: string, repo: GitHubRepo): Promise<ReadonlyArray<TaskCount>> => {
  const url = `${base(apiBase)}/github/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/issues?state=open&per_page=100`;
  return countByKind(Schema.decodeUnknownSync(Issues)(await request(url)));
};


// ── Kept on the phone, loaded at start ─────────────────────────────────────

const STORAGE_KEY = "agent-console-native:taskCounts";
const Saved = Schema.Record(Schema.String, Schema.Array(TaskCountSchema));
const SavedJson = Schema.fromJsonString(Saved);

/** How long counts count as fresh: GitHub allows an unauthenticated caller
 * 60 requests an hour. */
const FRESH_MS = 2 * 60 * 1000;

/** A repo's counts as known: the last loaded, and the last failure. */
export interface KnownCounts {
  readonly counts?: ReadonlyArray<TaskCount>;
  readonly error?: string;
}

let known: Readonly<Record<string, KnownCounts>> = {};
const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const keyOf = (repo: GitHubRepo): string => `${repo.owner}/${repo.name}`;

const set = (key: string, next: KnownCounts): void => {
  known = {
    ...known,
    [key]: next,
  };
  listeners.forEach((listener) => listener());
};

const save = (): void => {
  const counts: Record<string, ReadonlyArray<TaskCount>> = {};
  for (const [key, value] of Object.entries(known)) {
    if (value.counts !== undefined) counts[key] = value.counts;
  }
  AsyncStorage.setItem(STORAGE_KEY, Schema.encodeSync(SavedJson)(counts)).catch((error: unknown) =>
    console.error("[tasks] saving the counts failed", error),
  );
};

AsyncStorage.getItem(STORAGE_KEY)
  .then((raw) => {
    if (raw === null) return;
    const saved = Schema.decodeUnknownSync(SavedJson)(raw);
    // Anything loaded meanwhile is newer; keep it.
    const merged: Record<string, KnownCounts> = {};
    for (const [key, counts] of Object.entries(saved)) merged[key] = { counts };
    known = {
      ...merged,
      ...known,
    };
    listeners.forEach((listener) => listener());
  })
  .catch((error: unknown) => console.error("[tasks] reading the saved counts failed", error));

/** Refresh a repo's counts unless fresh or already under way. */
export const refreshTaskCounts = (apiBase: string, repo: GitHubRepo): Promise<void> => {
  const key = keyOf(repo);
  const at = fetchedAt.get(key);
  if (at !== undefined && Date.now() - at < FRESH_MS) return Promise.resolve();
  const running = inFlight.get(key);
  if (running !== undefined) return running;
  const run = fetchTaskCounts(apiBase, repo).then(
    (counts) => {
      fetchedAt.set(key, Date.now());
      set(key, { counts });
      save();
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tasks] loading ${key}'s counts failed`, error);
      // What was known stays shown; the failure is said alongside.
      set(key, {
        ...known[key],
        error: message,
      });
    },
  );
  const tracked = run.finally(() => inFlight.delete(key));
  inFlight.set(key, tracked);
  return tracked;
};

/** Refresh every GitHub repo's counts (Home, as the repos load). */
export const prefetchTaskCounts = (apiBase: string, repos: ReadonlyArray<ScannedRepo>): void => {
  for (const repo of repos) {
    if (repo.github !== undefined) void refreshTaskCounts(apiBase, repo.github);
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const NOTHING: KnownCounts = {};

/** A repo's counts as known now, read as the page renders; refreshed behind
 * when stale. */
export const useTaskCounts = (apiBase: string, repo: GitHubRepo | undefined): KnownCounts => {
  const key = repo === undefined ? undefined : keyOf(repo);
  const value = React.useSyncExternalStore(subscribe, () => (key === undefined ? NOTHING : (known[key] ?? NOTHING)));
  React.useEffect(() => {
    if (repo !== undefined) void refreshTaskCounts(apiBase, repo);
  }, [apiBase, repo]);
  return value;
};
