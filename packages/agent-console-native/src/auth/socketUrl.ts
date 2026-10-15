/**
 * The address of a paired server's WebSocket route: with a fresh one-use
 * ticket when the server is paired (a WebSocket from React Native cannot
 * carry the token header), else as it is. A ticket that cannot be had is
 * logged, and the address goes without one (the server then refuses it, and
 * the socket tries again).
 *
 * @internal
 */
import { Auth } from "agent-console-protocol";
import { Effect } from "effect";
import { type HttpClient, HttpClientResponse } from "effect/http";
import { tokenFor } from "./serverTokens";

/** `path` on the API server `api`, as a WebSocket address. */
export const socketUrl = (api: string, path: string): string => `${api.replace(/^http/, "ws")}${path}`;

/** `path` on `api`, ticketed when the server is paired. */
export const ticketedSocketUrl = (http: HttpClient.HttpClient, api: string, path: string): Effect.Effect<string> =>
  tokenFor(api) === undefined
    ? Effect.succeed(socketUrl(api, path))
    : http.post(`${api}${Auth.ticketPath}`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Auth.WebSocketTicket)),
        Effect.map(({ ticket }) => `${socketUrl(api, path)}?${Auth.ticketParam}=${encodeURIComponent(ticket)}`),
        Effect.catch((error) => Effect.logWarning(`no WebSocket ticket from ${api} for ${path}`, error).pipe(Effect.as(socketUrl(api, path)))),
      );
