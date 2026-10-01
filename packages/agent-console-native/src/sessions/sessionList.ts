/**
 * Every session on a server, from opencode's v2 list (`/api/session`, every
 * page): it holds sessions made through either API, while v1's list leaves
 * out the ones made through v2.
 *
 * `SessionSummary` is what the app's lists use of a session, whatever API
 * made it (times in epoch ms).
 *
 * @internal
 */
import { DateTime, Effect, Option, Stream } from "effect";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";
import type { SessionsCursor } from "../opencode/protocol/groups/session";
import type { Session } from "../opencode/schema/session";

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  /** Where it runs (absolute). */
  readonly directory: string;
  /** Set on a subagent's session. */
  readonly parentID?: string;
  readonly time: { readonly created: number; readonly updated: number };
}

/** A page's sessions, and the next page's cursor (none after the last). */
type Page = readonly [ReadonlyArray<SessionSummary>, Option.Option<Option.Option<SessionsCursor>>];

/** Sessions per page (the server's limit is larger; this keeps pages small). */
const PAGE = 100;

const summaryOf = (info: Session.Info): SessionSummary => ({
  id: info.id,
  title: info.title,
  directory: info.location.directory,
  parentID: info.parentID,
  time: { created: DateTime.toEpochMillis(info.time.created), updated: DateTime.toEpochMillis(info.time.updated) },
});

/** The server's sessions, most recently updated first. */
export const listSessions = (server: ServerAddress) =>
  Effect.gen(function* () {
    const opencode = yield* Opencode;
    const client = yield* opencode.client(server);
    // The state is the cursor of the page to fetch (none: the first page).
    return yield* Stream.paginate(Option.none<SessionsCursor>(), (cursor) =>
      client["server.session"]["session.list"]({
        query: Option.match(cursor, {
          onNone: () => ({ limit: PAGE, order: "desc" }),
          onSome: (next) => ({ cursor: next }),
        }),
      }).pipe(Effect.map((page): Page => [page.data.map(summaryOf), page.cursor.next === undefined ? Option.none() : Option.some(Option.some(page.cursor.next))])),
    ).pipe(Stream.runCollect);
  });
