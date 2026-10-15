/**
 * What the app asks of a session (opencode v2's session routes): rename it,
 * stop its turn, delete it, read it.
 *
 * @internal
 */
import { Effect } from "effect";
import { Opencode } from "../opencode/Opencode";
import type { SessionID } from "../opencode/schema/session-id";
import type { ServerAddress } from "../opencode/serverAddress";

const sessionsOf = (server: ServerAddress) =>
  Opencode.pipe(
    Effect.flatMap((opencode) => opencode.client(server)),
    Effect.map((client) => client["server.session"]),
  );

/** The session, as the server has it. */
export const getSession = (server: ServerAddress, sessionID: SessionID) =>
  sessionsOf(server).pipe(
    Effect.flatMap((sessions) => sessions["session.get"]({ params: { sessionID } })),
    Effect.map((response) => response.data),
  );

/** Gives the session a new title. */
export const renameSession = (server: ServerAddress, sessionID: SessionID, title: string) =>
  sessionsOf(server).pipe(Effect.flatMap((sessions) => sessions["session.update"]({ params: { sessionID }, payload: { title } })));

/** Stops the session's running turn. */
export const interruptSession = (server: ServerAddress, sessionID: SessionID) =>
  sessionsOf(server).pipe(Effect.flatMap((sessions) => sessions["session.interrupt"]({ params: { sessionID }, query: {} })));

/** Deletes the session and its child sessions. */
export const removeSession = (server: ServerAddress, sessionID: SessionID) =>
  sessionsOf(server).pipe(Effect.flatMap((sessions) => sessions["session.remove"]({ params: { sessionID } })));
