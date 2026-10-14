/**
 * Runs a command on the server for the app's own setup work (worktree
 * create, repo init/clone, folder mkdir), through opencode's shell routes
 * (opencode/shell.ts).
 *
 * @internal
 */
import { runApp } from "./effect/runtime";
import type { ServerAddress } from "./opencode/serverAddress";
import { runShell } from "./opencode/shell";

/** Runs `command` in `directory`; its output, trimmed. Rejects with the
 * command's own output when it fails. */
export const runRepoAdmin = (server: ServerAddress, directory: string, command: string): Promise<string> =>
  runApp(runShell(server, directory, command));
