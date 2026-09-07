/**
 * Real repo/worktree discovery — driven entirely by git's own on-disk
 * metadata, not folder location. A checkout is anything under `rootDir` (or one
 * level deeper — confirmed hands-on this matters: real repos here live at
 * `rootDir/packages/effect-pm`, not `rootDir/effect-pm`) with a `.git` entry.
 *
 * An Effect over OUR vite backend's `/fs` endpoints (fsClient.ts), NOT
 * opencode's file API: file access is a backend concern, and the backend
 * expands `~` and confines paths itself, so this walks by real absolute (or
 * `~/...`) paths with no `$HOME` round-trip. Run it through `runFs` at the React
 * boundary. Only the top-level root listing surfaces a `RepoScanError`;
 * everything below tolerates a missing/​unreadable path as "nothing there".
 *
 * @internal
 */
import { Data, Effect } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { type FsEntry, fsList, fsReadText } from "./fsClient";

export type ScannedWorktree = {
  readonly name: string;
  readonly path: string;
  readonly isMain: boolean;
};

export type ScannedRepo = {
  readonly repo: string;
  readonly worktrees: ReadonlyArray<ScannedWorktree>;
};

export class RepoScanError extends Data.TaggedError("RepoScanError")<{
  readonly rootDir: string;
}> {}

type GitEntry = { readonly checkoutDir: string; readonly gitType: "file" | "directory" };

/** Joins a checkout directory and a repo-relative path into one absolute path
 * the `/fs` endpoints understand; `.` is the directory itself. */
const at = (directory: string, path: string): string => (path === "." ? directory : `${directory}/${path}`);

/** Text read that tolerates a missing/unreadable file as `undefined`. */
const readFileText = (base: string, directory: string, path: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> =>
  fsReadText(base, at(directory, path)).pipe(Effect.orElseSucceed(() => undefined));

/** Directory listing that tolerates a missing/unreadable directory as empty. */
const listDir = (base: string, directory: string, path: string): Effect.Effect<ReadonlyArray<FsEntry>, never, HttpClient.HttpClient> =>
  fsList(base, at(directory, path)).pipe(Effect.orElseSucceed((): ReadonlyArray<FsEntry> => []));

const basename = (path: string): string => {
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? path;
};

const stripTrailingDotGit = (path: string): string =>
  path.endsWith("/.git") ? path.slice(0, -"/.git".length) : path;

const findGitEntries = (base: string, rootDir: string): Effect.Effect<ReadonlyArray<GitEntry>, RepoScanError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    // The root listing goes through fsList directly (not the tolerant helper),
    // so a broken root surfaces as a real error rather than an empty workspace.
    const rootEntries = yield* fsList(base, rootDir).pipe(Effect.mapError(() => new RepoScanError({ rootDir })));

    const rootDotGit = rootEntries.find((e) => e.name === ".git");
    const ownRoot: ReadonlyArray<GitEntry> =
      rootDotGit === undefined ? [] : [{ checkoutDir: rootDir, gitType: rootDotGit.type }];

    const level1 = rootEntries.filter((e) => e.type === "directory");

    const found = yield* Effect.forEach(
      level1,
      (entry) =>
        Effect.gen(function* () {
          const ownEntries = yield* listDir(base, rootDir, entry.name);
          const dotGit = ownEntries.find((e) => e.name === ".git");
          if (dotGit !== undefined) {
            const gitEntry: GitEntry = { checkoutDir: `${rootDir}/${entry.name}`, gitType: dotGit.type };
            return [gitEntry];
          }

          const level2 = ownEntries.filter((e) => e.type === "directory");
          const nested = yield* Effect.forEach(
            level2,
            (sub) =>
              Effect.gen(function* () {
                const subPath = `${entry.name}/${sub.name}`;
                const subEntries = yield* listDir(base, rootDir, subPath);
                const nestedDotGit = subEntries.find((e) => e.name === ".git");
                const result: GitEntry | undefined =
                  nestedDotGit === undefined
                    ? undefined
                    : { checkoutDir: `${rootDir}/${subPath}`, gitType: nestedDotGit.type };
                return result;
              }),
            { concurrency: 8 },
          );
          return nested.filter((e): e is GitEntry => e !== undefined);
        }),
      { concurrency: 8 },
    );

    return [...ownRoot, ...found.flat()];
  });

const resolveMainFromWorktreeGitFile = (base: string, checkoutDir: string): Effect.Effect<string | undefined, never, HttpClient.HttpClient> =>
  readFileText(base, checkoutDir, ".git").pipe(
    Effect.map((content) => {
      if (content === undefined) return undefined;

      const match = content.trim().match(/^gitdir:\s*(.+)$/);
      if (match === null || match[1] === undefined) return undefined;

      const gitdirPath = match[1].trim();
      if (!gitdirPath.startsWith("/")) return undefined;

      const marker = "/.git/worktrees/";
      const markerIndex = gitdirPath.indexOf(marker);
      if (markerIndex === -1) return undefined;

      const afterMarker = gitdirPath.slice(markerIndex + marker.length);
      if (afterMarker.length === 0 || afterMarker.includes("/")) return undefined;

      return gitdirPath.slice(0, markerIndex);
    }),
  );

const listLinkedWorktrees = (base: string, mainCheckoutDir: string): Effect.Effect<ReadonlyArray<ScannedWorktree>, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const entries = yield* listDir(base, mainCheckoutDir, ".git/worktrees");
    const names = entries.filter((e) => e.type === "directory").map((e) => e.name);

    const worktrees = yield* Effect.forEach(
      names,
      (name) =>
        readFileText(base, mainCheckoutDir, `.git/worktrees/${name}/gitdir`).pipe(
          Effect.map((content): ScannedWorktree | undefined =>
            content === undefined ? undefined : { name, path: stripTrailingDotGit(content.trim()), isMain: false },
          ),
        ),
      { concurrency: 8 },
    );

    return worktrees.filter((w): w is ScannedWorktree => w !== undefined);
  });

const resolveRepoName = (base: string, mainCheckoutDir: string): Effect.Effect<string, never, HttpClient.HttpClient> =>
  readFileText(base, mainCheckoutDir, ".git/config").pipe(
    Effect.map((config) => (config === undefined ? undefined : repoNameFromConfig(config)) ?? basename(mainCheckoutDir)),
  );

const repoNameFromConfig = (config: string): string | undefined => {
  const originSection = config.match(/\[remote "origin"\][^[]*/);
  const anySection = originSection?.[0] ?? config.match(/\[remote "[^"]+"\][^[]*/)?.[0];
  if (anySection === undefined) return undefined;

  const urlMatch = anySection.match(/url\s*=\s*(\S+)/);
  if (urlMatch === null || urlMatch[1] === undefined) return undefined;

  return repoNameFromRemoteUrl(urlMatch[1]);
};

const repoNameFromRemoteUrl = (url: string): string | undefined => {
  const withoutDotGit = url.trim().replace(/\.git$/, "");
  const segments = withoutDotGit.split(/[/:]/).filter((s) => s.length > 0);
  return segments[segments.length - 1];
};

export const scanRepos = (base: string, rootDir: string): Effect.Effect<ReadonlyArray<ScannedRepo>, RepoScanError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const entries = yield* findGitEntries(base, rootDir);

    const mains = new Set<string>();
    for (const entry of entries) {
      if (entry.gitType === "directory") {
        mains.add(entry.checkoutDir);
      } else {
        const main = yield* resolveMainFromWorktreeGitFile(base, entry.checkoutDir);
        if (main !== undefined) mains.add(main);
      }
    }

    return yield* Effect.forEach(
      Array.from(mains),
      (mainCheckoutDir) =>
        Effect.gen(function* () {
          const [linked, repo] = yield* Effect.all([
            listLinkedWorktrees(base, mainCheckoutDir),
            resolveRepoName(base, mainCheckoutDir),
          ]);
          const main: ScannedWorktree = { name: "(main)", path: mainCheckoutDir, isMain: true };
          const scanned: ScannedRepo = { repo, worktrees: [main, ...linked] };
          return scanned;
        }),
      { concurrency: 8 },
    );
  });
