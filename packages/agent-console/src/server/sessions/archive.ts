/**
 * What the user marked on sessions, which opencode has no notion of:
 *
 * - **archived**: put away; the app leaves them out of its lists, and the
 *   Archived page lists them;
 * - **muted**: no notifications (the notifier reads the same file before it
 *   sends anything about a session; files.ts names the files).
 *
 * Each is one list for every device, keyed by session id with when it was
 * marked, changed one session at a time, so two devices at once do not
 * overwrite each other. Stored as JSON under the server's state folder
 * (`AGENT_CONSOLE_STATE_DIR`, else `.agent-console`).
 *
 * @internal
 */
import { NodeServices } from "@effect/platform-node";
import { Clock, Context, Effect, FileSystem, Layer, Path, Schema, SynchronizedRef } from "effect";
import { archivedSessionsFile, mutedSessionsFile, stateFolderName } from "./files";

/** When each marked session was marked, by session id. */
export const ArchivedSessions = Schema.Record(Schema.String, Schema.Number);
export type ArchivedSessions = typeof ArchivedSessions.Type;


const archiveJson = Schema.fromJsonString(ArchivedSessions);

export const sessionIdPayload = Schema.Struct({
  id: Schema.String,
});

/** A marked set (the archive, the muted) could not be read or written. */
export class SessionArchiveError extends Schema.TaggedErrorClass<SessionArchiveError>()("SessionArchiveError", {
  message: Schema.String,
}) {}

const failed = (message: string) => (cause: unknown) =>
  new SessionArchiveError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

/** One marked set of sessions, kept in `fileName` under the state folder. */
const markedSet = (fileName: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = process.env.AGENT_CONSOLE_STATE_DIR ?? path.join(process.cwd(), stateFolderName);
    const file = path.join(dir, fileName);

    const read = fs.exists(file).pipe(
      Effect.flatMap((exists) => (exists ? fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeUnknownEffect(archiveJson))) : Effect.succeed<ArchivedSessions>({}))),
      Effect.mapError(failed(`reading ${file}`)),
    );

    /** The set as last read or written; every change goes through here,
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
      add: (id: string) =>
        change((current, now) =>
          id in current
            ? current
            : {
                ...current,
                [id]: now,
              },
        ),
      remove: (id: string) => change((current) => Object.fromEntries(Object.entries(current).filter(([marked]) => marked !== id))),
    };
  });

const make = Effect.gen(function* () {
  const archived = yield* markedSet(archivedSessionsFile);
  const muted = yield* markedSet(mutedSessionsFile);
  return {
    list: archived.list,
    archive: archived.add,
    unarchive: archived.remove,
    muted: muted.list,
    mute: muted.add,
    unmute: muted.remove,
  };
});

export class SessionArchive extends Context.Service<SessionArchive, Effect.Success<typeof make>>()("agent-console/SessionArchive") {
  static readonly layer = Layer.effect(SessionArchive, make).pipe(Layer.provide(NodeServices.layer));
}
