/**
 * Read the current branch and list local branches for a checkout, via OUR vite
 * backend's `/fs` endpoints (no shell, no opencode) — as Effect. Worktrees
 * store `.git` as a file pointing at a gitdir — HEAD lives there, while branch
 * refs stay on the main checkout's `.git`. Run through `runFs` at the React
 * boundary.
 *
 * @internal
 */
import { Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { type FsEntry, fsList, fsReadText } from "./fsClient";

/** Joins a checkout directory and a repo-relative path into one absolute path
 * the `/fs` endpoints understand. */
const at = (directory: string, path: string): string => `${directory}/${path}`;

/** Text read that tolerates a missing/unreadable file as `undefined`. */
const readFileText = (base: string, directory: string, path: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> =>
  fsReadText(base, at(directory, path)).pipe(Effect.orElseSucceed(() => undefined));

const parseHeadRef = (content: string): string | undefined => {
  const trimmed = content.trim();
  const refMatch = trimmed.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (refMatch?.[1] !== undefined) return refMatch[1];
  // Detached HEAD — short sha for display.
  if (/^[0-9a-f]{7,40}$/i.test(trimmed)) return trimmed.slice(0, 7);
  return undefined;
};

/** Absolute gitdir for a checkout, if `.git` is a `gitdir:` file. */
const resolveGitdir = (base: string, checkoutDir: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> =>
  readFileText(base, checkoutDir, ".git").pipe(
    Effect.map((content) => {
      if (content === undefined) return undefined;
      const match = content.trim().match(/^gitdir:\s*(.+)$/);
      if (match === null || match[1] === undefined) return undefined;
      const gitdir = match[1].trim();
      return gitdir.startsWith("/") ? gitdir : undefined;
    }),
  );

/** Current branch (or short detached SHA) for a worktree/checkout path. */
export const readCurrentBranch = (base: string, checkoutDir: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const gitdir = yield* resolveGitdir(base, checkoutDir);
    const head = gitdir !== undefined
      ? yield* readFileText(base, gitdir, "HEAD")
      : yield* readFileText(base, checkoutDir, ".git/HEAD");
    return head === undefined ? undefined : parseHeadRef(head);
  });

/** Local branch names from the main checkout's refs (+ packed-refs). */
export const listLocalBranches = (base: string, mainCheckoutDir: string): Effect.Effect<ReadonlyArray<string>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const names = new Set<string>();

    const walkHeads = (relative: string, prefix: string): Effect.Effect<void, never, HttpClient.HttpClient> =>
      Effect.gen(function* () {
        // A missing refs/heads is fine (empty repo / packed-only) — fsList
        // returns [] for a 404, and a transport error is tolerated as empty.
        const entries: ReadonlyArray<FsEntry> = yield* fsList(base, at(mainCheckoutDir, relative)).pipe(
          Effect.orElseSucceed((): ReadonlyArray<FsEntry> => []),
        );
        for (const entry of entries) {
          const full = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
          if (entry.type === "directory") {
            yield* walkHeads(`${relative}/${entry.name}`, full);
          } else {
            names.add(full);
          }
        }
      });

    yield* walkHeads(".git/refs/heads", "");

    const packed = yield* readFileText(base, mainCheckoutDir, ".git/packed-refs");
    if (packed !== undefined) {
      for (const line of packed.split("\n")) {
        if (line.startsWith("#") || line.startsWith("^")) continue;
        const match = line.match(/^[0-9a-f]+\s+refs\/heads\/(\S+)/i);
        if (match?.[1] !== undefined) names.add(match[1]);
      }
    }

    return Array.from(names).sort((a, b) => a.localeCompare(b));
  });
