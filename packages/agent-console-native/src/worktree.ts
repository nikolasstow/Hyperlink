/**
 * Worktree creation: runs `git worktree add` on the server (repoAdmin.ts) at
 * the path the owner's template gives.
 *
 * @internal
 */
import type { ServerAddress } from "./opencode/serverAddress";
import { runRepoAdmin } from "./repoAdmin";
import {
  DEFAULT_WORKTREE_TEMPLATE,
  getWorktreeTemplate,
  resolveWorktreePath,
} from "./settings";

export { DEFAULT_WORKTREE_TEMPLATE, resolveWorktreePath };

export const createWorktree = async (
  server: ServerAddress,
  rootDir: string,
  repo: string,
  mainCheckoutPath: string,
  name: string,
): Promise<string> => {
  const template = await getWorktreeTemplate();
  const worktreePath = resolveWorktreePath(rootDir, repo, name, template);
  await runRepoAdmin(server, mainCheckoutPath, `git worktree add ${JSON.stringify(worktreePath)} -b ${JSON.stringify(name)}`);
  return worktreePath;
};
