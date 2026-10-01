/**
 * The part of opencode's v2 API the app calls, assembled from the vendored
 * protocol groups (`./protocol`, the server's own `HttpApi` definitions): an
 * `HttpApiClient` derived from it encodes every request and decodes every
 * response (and the event stream) with the server's schemas.
 *
 * The server attaches its own middleware to these groups (where a session
 * lives, authorization, request validation). They run server-side; the
 * client only takes their error schemas, so a rejected request fails with the
 * server's typed error. The session-location key here stands in for the
 * server's (the group takes its key as a parameter).
 *
 * @internal
 */
import { HttpApi, HttpApiMiddleware } from "effect/unstable/httpapi";
import { EventGroup } from "./protocol/groups/event";
import { HealthGroup } from "./protocol/groups/health";
import { MessageGroup } from "./protocol/groups/message";
import { makeSessionGroup } from "./protocol/groups/session";
import { Authorization } from "./protocol/middleware/authorization";
import { SchemaErrorMiddleware } from "./protocol/middleware/schema-error";

/** Resolves a session's location on the server; nothing to do client-side. */
export class SessionLocation extends HttpApiMiddleware.Service<SessionLocation>()("@doubleagent/opencode/SessionLocation") {}

export const OpencodeApi = HttpApi.make("opencode")
  .add(HealthGroup)
  .add(makeSessionGroup(SessionLocation))
  .add(MessageGroup.middleware(SessionLocation))
  .add(EventGroup)
  .middleware(Authorization)
  .middleware(SchemaErrorMiddleware);
