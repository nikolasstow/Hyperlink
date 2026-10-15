/**
 * Where a skill's file opens in Files: the workspace it belongs to, not its
 * own folder (which Files would take for a repo of its own). Pure.
 *
 * @internal
 */
import { under } from "./pathForms";

/** The folders agents keep their skills in, by name. */
const AGENT_FOLDERS: ReadonlySet<string> = new Set([".claude", ".agents", ".opencode", "opencode"]);

export interface FilesPlace {
  readonly repo: string;
  readonly dir: string;
}

const lastSegment = (path: string): string => path.split("/").filter(Boolean).pop() ?? path;

/**
 * The place for the skill file at `path`: the scanned repo it is in (a
 * project's own skills, `repoOf` naming it with its worktree); else the
 * agent folder holding it (`~/.claude`, a config's `opencode`); else the
 * server's root folder (`rootDir`) when it is under it; else its own folder.
 */
export const skillPlace = (path: string, rootDir: string, repoOf: (folder: string) => FilesPlace | undefined): FilesPlace => {
  const folder = path.slice(0, path.lastIndexOf("/"));
  const repo = repoOf(folder);
  if (repo !== undefined) return repo;
  const segments = folder.split("/");
  for (let index = segments.length - 1; index > 0; index--) {
    if (AGENT_FOLDERS.has(segments[index] ?? "")) {
      const dir = segments.slice(0, index + 1).join("/");
      return { repo: lastSegment(dir), dir };
    }
  }
  if (under(path, rootDir) !== undefined) return { repo: lastSegment(rootDir), dir: rootDir };
  return { repo: lastSegment(folder), dir: folder };
};
