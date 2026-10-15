/**
 * Opencode, forwarded: `/opencode/*` on this server goes to the opencode server
 * (opencodeServer.ts) with the
 * rest of the path, the query, the method, the headers and the body, and its
 * response comes back as it streams (so `/global/event` stays live). The app
 * reaches everything through this one server; opencode itself need only listen
 * on this machine.
 *
 * The app's own credentials (its token, a WebSocket ticket) stop here: opencode
 * gets its own password instead, which never reaches the phone.
 *
 * @internal
 */
import { Effect, Option } from "effect";
import { Auth } from "agent-console-protocol";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "./opencodeServer";
import { Headers, HttpClient, HttpClientRequest, HttpRouter, HttpServerResponse } from "effect/http";

/** Where the app's opencode client points, under this server. */
export const OPENCODE_PREFIX = "/opencode";

/** Headers that describe one hop's connection, never forwarded. The body's
 * length and encoding are the transport's to set again (fetch decodes). */
const HOP_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding", "proxy-connection", "te", "trailer"]);

const forwardable = (headers: Headers.Headers): Headers.Headers => Headers.removeMany(headers, [...HOP_HEADERS]);


export const opencodeProxyRoute = HttpRouter.add("*", `${OPENCODE_PREFIX}/*`, (request) =>
  Effect.gen(function* () {
    const base = yield* opencodeUrl;
    const client = yield* HttpClient.HttpClient;
    const password = yield* opencodePassword;
    const incoming = new URL(request.originalUrl, "http://localhost");
    incoming.searchParams.delete(Auth.ticketParam);
    const rest = incoming.pathname.slice(OPENCODE_PREFIX.length);
    const target = `${base.replace(/\/+$/, "")}${rest === "" ? "/" : rest}${incoming.search}`;
    const contentType = Option.getOrUndefined(Headers.get(request.headers, "content-type"));
    const outgoing = HttpClientRequest.make(request.method)(target, {
      headers: withOpencodeAuth(forwardable(request.headers), password),
    });
    const withBody =
      request.method === "GET" || request.method === "HEAD" ? outgoing : HttpClientRequest.bodyStream(outgoing, request.stream, { contentType });
    return yield* client.execute(withBody).pipe(
      Effect.map((response) =>
        HttpServerResponse.stream(response.stream, {
          status: response.status,
          headers: forwardable(response.headers),
        }),
      ),
      Effect.catch((error) =>
        Effect.logWarning(`opencode forward: ${request.method} ${rest} failed`, error).pipe(
          Effect.as(
            HttpServerResponse.jsonUnsafe(
              {
                error: "opencode unreachable",
              },
              { status: 502 },
            ),
          ),
        ),
      ),
    );
  }),
);
