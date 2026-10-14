/**
 * The part of opencode's v2 API the app calls, assembled from the vendored
 * protocol groups (`./protocol`, the server's own `HttpApi` definitions): an
 * `HttpApiClient` derived from it encodes every request and decodes every
 * response (and the event stream) with the server's schemas.
 *
 * The server attaches its own middleware to these groups (where a request or
 * a session lives, authorization, request validation). They run server-side;
 * the client only takes their error schemas, so a rejected request fails with
 * the server's typed error. The location keys here stand in for the server's
 * (the groups take their keys as parameters).
 *
 * @internal
 */
import { HttpApi, HttpApiMiddleware } from "effect/http-api";
import { CommandGroup } from "./protocol/groups/command";
import { EventGroup } from "./protocol/groups/event";
import { MessageGroup } from "./protocol/groups/message";
import { ModelGroup } from "./protocol/groups/model";
import { makePermissionGroup } from "./protocol/groups/permission";
import { ServerGroup } from "./protocol/groups/server";
import { ShellGroup } from "./protocol/groups/shell";
import { makeSessionGroup } from "./protocol/groups/session";
import { SkillGroup } from "./protocol/groups/skill";
import { Authorization } from "./protocol/middleware/authorization";
import { SchemaErrorMiddleware } from "./protocol/middleware/schema-error";

/** Resolves a request's folder on the server; nothing to do client-side. */
export class Location extends HttpApiMiddleware.Service<Location>()("@doubleagent/opencode/Location") {}
/** Resolves a session's location on the server; nothing to do client-side. */
export class SessionLocation extends HttpApiMiddleware.Service<SessionLocation>()("@doubleagent/opencode/SessionLocation") {}
/** Resolves a form's location on the server; nothing to do client-side. */
export class FormLocation extends HttpApiMiddleware.Service<FormLocation>()("@doubleagent/opencode/FormLocation") {}

export const OpencodeApi = HttpApi.make("opencode")
  .add(ServerGroup)
  .add(makeSessionGroup(SessionLocation, FormLocation))
  .add(MessageGroup)
  .add(EventGroup)
  .add(makePermissionGroup(Location, SessionLocation))
  .add(CommandGroup.middleware(Location))
  .add(SkillGroup.middleware(Location))
  .add(ModelGroup.middleware(Location))
  .add(ShellGroup.middleware(Location))
  .middleware(Authorization)
  .middleware(SchemaErrorMiddleware);
