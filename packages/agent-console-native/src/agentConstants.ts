/**
 * Kept in its own leaf module to avoid an import cycle (session lists use it).
 *
 * @internal
 */

/** The title v1's background operations (worktree setup, settings-file
 * writes) gave the sessions they ran in. v2 runs commands without a session
 * (opencode/shell.ts); session lists still filter out the old ones. */
export const WORKTREE_SETUP_PREFIX = "[worktree-setup]";

/** Every session the app makes runs under the no-edit "console" agent. */
export const AGENT = "console";
