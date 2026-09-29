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

export const archivedSessionsFile = "archived-sessions.json";
export const mutedSessionsFile = "muted-sessions.json";
