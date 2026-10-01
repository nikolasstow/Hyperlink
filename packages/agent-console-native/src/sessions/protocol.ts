/**
 * Which opencode API a session is spoken to over. v1 and v2 keep separate
 * histories, so a session stays with the one that made it: a session with v1
 * history is v1 (v2 cannot see that history; prompted through v2, the agent
 * would start without the conversation); otherwise it is v2 (made through v2,
 * or new: everything new is v2).
 *
 * @internal
 */
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import type { SessionID } from "../opencode/schema/session-id";
import type { Protocol } from "../outbox/model";

/** v1's message list, as far as needed here: how many. */
const V1Messages = Schema.Array(Schema.Unknown);

export const sessionProtocol = (server: ServerAddress, sessionID: SessionID): Effect.Effect<Protocol, never, Opencode | HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const opencode = yield* Opencode;
    const client = yield* opencode.client(server);
    const v2 = yield* client["server.message"]["session.messages"]({ params: { sessionID }, query: { limit: 1 } }).pipe(
      Effect.map((page) => page.data.length > 0),
      // Not there yet (still in the outbox): new, so v2.
      Effect.catchTag("SessionNotFoundError", () => Effect.succeed(true)),
    );
    if (v2) return "v2";
    const http = yield* HttpClient.HttpClient;
    const v1 = yield* http.get(`${server}/session/${sessionID}/message`, { urlParams: { limit: "1" } }).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(V1Messages)),
      Effect.map((messages) => messages.length > 0),
    );
    return v1 ? "v1" : "v2";
  }).pipe(
    // Unknown (unreachable, or an answer that does not decode): v2, the
    // default for anything without v1 history; said, not hidden.
    Effect.catchCause((cause) => Effect.logWarning("[sessions] could not tell the session's protocol; taking v2", cause).pipe(Effect.as<Protocol>("v2"))),
  );

/** Stops a v2 session's running turn. */
export const interruptSession = (server: ServerAddress, sessionID: SessionID) =>
  Effect.gen(function* () {
    const opencode = yield* Opencode;
    const client = yield* opencode.client(server);
    yield* client["server.session"]["session.interrupt"]({ params: { sessionID } });
  });
