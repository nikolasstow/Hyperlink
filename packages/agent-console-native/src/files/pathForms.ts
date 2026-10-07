/**
 * One folder written two ways compares equal: opencode writes some paths from
 * home (`~/…`), others in full (`/Users/me/…`, `/home/me/…`). Pure (no React,
 * no storage), so the Files store and its tests use it too.
 *
 * @internal
 */

/** A path from the home folder, whichever way it is written: opencode writes
 * some as `~/…`, others in full (`/Users/me/…`, `/home/me/…`), so two ways of
 * writing one folder compare equal. No trailing slash. */
export const fromHome = (path: string): string =>
  path
    .replace(/\/+$/, "")
    .replace(/^~(?=\/|$)/, "")
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "");

/** What of `path` is under `root` (`""` for the root itself, `"/src/x"`
 * under it), or undefined outside it. */
export const under = (path: string, root: string): string | undefined => {
  const base = fromHome(root);
  const at = fromHome(path);
  return at === base ? "" : at.startsWith(`${base}/`) ? at.slice(base.length) : undefined;
};

