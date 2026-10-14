/**
 * Where the session marks live, shared by the API server (sessions/archive.ts,
 * which keeps them) and the notifier (notificationsPlugin.ts, which reads the
 * muted list before it sends). A module of names alone, so the notifier does
 * not load the server's code to know them.
 *
 * @internal
 */

/** The state folder both servers run in (`AGENT_CONSOLE_STATE_DIR`, else
 * `.agent-console` under the working folder). */
export const stateFolderName = ".agent-console";

/** The state folder itself: `AGENT_CONSOLE_STATE_DIR`, else `.agent-console`
 * under the working folder (`join` is the platform's path join). */
export const stateDirectory = (join: (...parts: ReadonlyArray<string>) => string): string =>
  process.env.AGENT_CONSOLE_STATE_DIR ?? join(process.cwd(), stateFolderName);

export const devicesFile = "devices.json";
export const adminTokenFile = "admin-token";

export const archivedSessionsFile = "archived-sessions.json";
export const mutedSessionsFile = "muted-sessions.json";
