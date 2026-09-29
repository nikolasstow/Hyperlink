/**
 * Archived sessions: the sessions the user put away. opencode has no archive
 * of its own, so the backend keeps which sessions are archived, and when; the
 * app leaves them out of its lists, and the archive page (to come) lists them.
 *
 * One list for every device, changed one session at a time (archive,
 * unarchive), so two devices archiving at once do not overwrite each other.
 * Stored as JSON under the server's state folder (`AGENT_CONSOLE_STATE_DIR`,
 * else `.agent-console`).
 *
 * @internal
 */
import { NodeServices } from "@effect/platform-node";
import { Clock, Context, Effect, FileSystem, Layer, Path, Schema, SynchronizedRef } from "effect";

/** When each archived session was archived, by session id. */
export const ArchivedSessions = Schema.Record(Schema.String, Schema.Number);
export type ArchivedSessions = typeof ArchivedSessions.Type;

const archiveJson = Schema.fromJsonString(ArchivedSessions);

export const sessionIdPayload = Schema.Struct({
  id: Schema.String,
});

/** The archive could not be read or written. */
export class SessionArchiveError extends Schema.TaggedErrorClass<SessionArchiveError>()("SessionArchiveError", {
  message: Schema.String,
}) {}

const failed = (message: string) => (cause: unknown) =>
  new SessionArchiveError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = process.env.AGENT_CONSOLE_STATE_DIR ?? path.join(process.cwd(), ".agent-console");
  const file = path.join(dir, "archived-sessions.json");

  const read = fs.exists(file).pipe(
    Effect.flatMap((exists) => (exists ? fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(archiveJson))) : Effect.succeed<ArchivedSessions>({}))),
    Effect.mapError(failed(`reading ${file}`)),
  );

  /** The archive as last read or written; every change goes through here,
   * one at a time, and is written before it is kept. */
  const archive = yield* SynchronizedRef.make<ArchivedSessions | undefined>(undefined);

  const change = (update: (current: ArchivedSessions, now: number) => ArchivedSessions) =>
    SynchronizedRef.modifyEffect(archive, (known) =>
      Effect.gen(function* () {
        const current = known ?? (yield* read);
        const next = update(current, yield* Clock.currentTimeMillis);
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.andThen(Schema.encodeEffect(archiveJson)(next)),
          Effect.flatMap((text) => fs.writeFileString(file, text)),
          Effect.mapError(failed(`writing ${file}`)),
        );
        const result: readonly [ArchivedSessions, ArchivedSessions | undefined] = [next, next];
        return result;
      }),
    );

  return {
    list: SynchronizedRef.modifyEffect(archive, (known) =>
      (known === undefined ? read : Effect.succeed(known)).pipe(
        Effect.map((current): readonly [ArchivedSessions, ArchivedSessions | undefined] => [current, current]),
      ),
    ),
    archive: (id: string) =>
      change((current, now) =>
        id in current
          ? current
          : {
              ...current,
              [id]: now,
            },
      ),
    unarchive: (id: string) => change((current) => Object.fromEntries(Object.entries(current).filter(([archived]) => archived !== id))),
  };
});

export class SessionArchive extends Context.Service<SessionArchive, Effect.Success<typeof make>>()("agent-console/SessionArchive") {
  static readonly layer = Layer.effect(SessionArchive, make).pipe(Layer.provide(NodeServices.layer));
}
