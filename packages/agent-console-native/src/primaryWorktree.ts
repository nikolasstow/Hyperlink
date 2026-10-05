/**
 * Each repo's primary worktree: the one its worktree pages open on. There is
 * always one (the main checkout until another is chosen), and it is the
 * default wherever a worktree matters: Files, the NPM page and the plugin
 * pages under it open on it, and a new session starts in it. Choosing another
 * from any worktree picker changes it everywhere at once.
 *
 * The repo screen is not one of those: nothing on it belongs to a single
 * worktree (its sessions can be in any), so it has no picker and does not
 * follow the primary.
 *
 * Remembered on this device, per repo, by the worktree's path.
 *
 * @internal
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Option, Schema } from "effect";
import * as React from "react";
import { readWorkspace } from "./repoScanCache";
import type { ScannedRepo, ScannedWorktree } from "./repoScan";

const storageKey = "primaryWorktreeByRepo";
const savedPrimaries = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const primaryByRepo = new Map<string, string>();
let repos: ReadonlyArray<ScannedRepo> = [];
let version = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  version += 1;
  listeners.forEach((listener) => listener());
};

/** The remembered primaries and the scanned repos, read once. */
const loaded: Promise<void> = Promise.all([
  AsyncStorage.getItem(storageKey).then(
    (raw) => {
      if (raw === null) return;
      Option.match(Schema.decodeUnknownOption(savedPrimaries)(raw), {
        onNone: () => console.error("[primary worktree] the saved worktrees are unreadable; starting from each repo's main checkout"),
        onSome: (saved) => Object.entries(saved).forEach(([repo, path]) => primaryByRepo.set(repo, path)),
      });
    },
    (error: unknown) => console.error("[primary worktree] reading the saved worktrees failed", error),
  ),
  readWorkspace().then(
    (scan) => {
      if (scan !== undefined && repos.length === 0) repos = scan;
    },
    (error: unknown) => console.error("[primary worktree] reading the scanned repos failed", error),
  ),
]).then(emit);

/** Take a newer scan (Home rescans). */
export const updateScannedRepos = (scan: ReadonlyArray<ScannedRepo>): void => {
  repos = scan;
  emit();
};

/** The scanned repo a folder is in (one of its worktrees, or inside one), or
 * undefined for a folder outside every scanned repo. */
export const repoOfDirectory = (directory: string): string | undefined =>
  repos.find((candidate) => candidate.worktrees.some((worktree) => directory === worktree.path || directory.startsWith(`${worktree.path.replace(/\/+$/, "")}/`)))?.repo;

export const worktreesOf = (repo: string): ReadonlyArray<ScannedWorktree> => repos.find((candidate) => candidate.repo === repo)?.worktrees ?? [];

/** A repo's primary worktree: the chosen one while it exists, else the main
 * checkout. Undefined for a folder that is not a scanned repo. */
export const primaryWorktreeOf = (repo: string): ScannedWorktree | undefined => {
  const worktrees = worktreesOf(repo);
  const chosen = primaryByRepo.get(repo);
  return worktrees.find((worktree) => worktree.path === chosen) ?? worktrees.find((worktree) => worktree.isMain) ?? worktrees[0];
};

/** The worktree chosen as primary, if one was chosen and still exists: a
 * choice made, over the main checkout it otherwise is. */
export const chosenPrimaryOf = (repo: string): ScannedWorktree | undefined => {
  const chosen = primaryByRepo.get(repo);
  return chosen === undefined ? undefined : worktreesOf(repo).find((worktree) => worktree.path === chosen);
};

/** Make `path` the repo's primary worktree, everywhere. */
export const setPrimaryWorktree = (repo: string, path: string): void => {
  primaryByRepo.set(repo, path);
  emit();
  void loaded
    .then(() => AsyncStorage.setItem(storageKey, Schema.encodeSync(savedPrimaries)(Object.fromEntries(primaryByRepo))))
    .catch((error: unknown) => console.error("[primary worktree] saving the worktree failed", error));
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The worktree chosen as a repo's primary, kept current: what the new
 * session composer follows. Undefined until one is chosen. */
export const useChosenPrimary = (repo: string | undefined): ScannedWorktree | undefined => {
  React.useSyncExternalStore(subscribe, () => version);
  return repo === undefined ? undefined : chosenPrimaryOf(repo);
};

/**
 * A repo's worktrees and the folder its worktree pages show: the primary
 * worktree, kept current. `fallback` is the folder while the repo is not (or
 * not yet) known as a scanned repo.
 */
export const usePrimaryWorktree = (
  repo: string,
  fallback: string,
): {
  readonly dir: string;
  readonly primary: ScannedWorktree | undefined;
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
} => {
  // Re-render on any change to the primaries or the scan.
  React.useSyncExternalStore(subscribe, () => version);
  const primary = primaryWorktreeOf(repo);
  return {
    dir: primary?.path ?? fallback,
    primary,
    worktrees: worktreesOf(repo),
  };
};
