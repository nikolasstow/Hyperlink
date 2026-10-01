/**
 * The server's sessions for React (sessionList.ts through the app runtime):
 * a Promise of every session, most recently updated first. Rejects with the
 * failure, which callers say (and log), never swallow.
 *
 * @internal
 */
import { runApp } from "../effect/runtime";
import { serverAddressOf } from "../opencode/serverAddress";
import { listSessions, type SessionSummary } from "./sessionList";

export const fetchSessions = (address: string): Promise<ReadonlyArray<SessionSummary>> => runApp(listSessions(serverAddressOf(address)));
