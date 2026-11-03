/**
 * The context a page reads beyond its own project: the repos the app knows
 * and the live sessions. These back `da.repos.list()` and
 * `da.sessions.list()` in the page SDK (sdk.ts).
 *
 * Repos come from the `Workspaces` service — the repo and worktree folders the
 * app registered. Sessions come from opencode, fetched server-side through the
 * same address and password the proxy uses, so the page never talks to
 * opencode directly. The wire shapes (`Repo`, `Session`) live in
 * `agent-console-protocol/Projects`.
 *
 * @internal
 */
import { Repo, Session } from "agent-console-protocol/Projects";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";
import { Workspaces } from "../workspaces";
import { ProjectsError } from "./store";

/** opencode's session shape, read for the fields a list needs. */
const OpencodeSession = Schema.Struct({
  id: Schema.String,
  title: Schema.optional(Schema.String),
  time: Schema.optional(Schema.Struct({ updated: Schema.optional(Schema.Number) })),
});

/** The repos the app registered, from a resolved `Workspaces` service. The
 * group resolves `Workspaces` once at build time (serve.ts), so this takes the
 * service rather than requiring it, and nothing leaks into the request. */
export const reposListOf = (workspaces: Workspaces["Service"]): Effect.Effect<ReadonlyArray<Repo>> =>
  workspaces.list.pipe(
    Effect.map((dirs) =>
      dirs.map((dir: string) => ({
        name: dir.split("/").filter((part: string) => part.length > 0).at(-1) ?? dir,
        dir,
      })),
    ),
  );

export const sessionsList: Effect.Effect<ReadonlyArray<Session>, ProjectsError, HttpClient.HttpClient> = Effect.gen(function* () {
  const base = yield* opencodeUrl.pipe(Effect.mapError((cause) => new ProjectsError({ message: `opencode url config: ${String(cause)}` })));
  const password = yield* opencodePassword.pipe(Effect.mapError((cause) => new ProjectsError({ message: `opencode password config: ${String(cause)}` })));
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.get(`${base.replace(/\/+$/, "")}/session`).pipe(
    (self) => HttpClientRequest.setHeaders(self, withOpencodeAuth(self.headers, password)),
  );
  const sessions = yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(OpencodeSession))),
    Effect.mapError((cause) => new ProjectsError({ message: `listing sessions: ${cause instanceof Error ? cause.message : String(cause)}` })),
  );
  return sessions.map(
    (session): Session => ({
      id: session.id,
      title: session.title ?? "Untitled session",
      updatedAt: session.time?.updated,
    }),
  );
});
