/**
 * What `/` offers in a composer: each folder's commands and skills, as the
 * server sends them (`GET /commands`, agent-console-protocol `Commands`), kept
 * on the device and read back at launch, so the list is there before `/` is
 * typed.
 *
 * Loaded ahead: at app open and on return to the foreground, every folder
 * known is fetched again (CommandCatalogSync). opencode loads a folder's
 * skills a moment after the folder is first used, so a first answer can be
 * short: while the app is open it also follows opencode's events, and a
 * folder whose commands or skills changed (`command.updated`,
 * `skill.updated`) is fetched again.
 *
 * @internal
 */
import { Context, Duration, Effect, Layer, Option, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { Commands } from "agent-console-protocol";
import { Opencode } from "../opencode/Opencode";
import type { ServerAddress } from "../opencode/serverAddress";

const STORE_KEY = "lists";
/** Events that come together (opencode sends both) are taken as one. */
const EVENT_WINDOW = "250 millis";
const RECONNECT_FIRST = "500 millis";
const RECONNECT_LONGEST = Duration.seconds(30);

const reconnect = Schedule.exponential(RECONNECT_FIRST).pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, RECONNECT_LONGEST))),
  Schedule.jittered,
);

/** The lists kept on the device, by folder (`""`: the server's own). */
const Lists = Schema.Record(Schema.String, Commands.List);
type Lists = typeof Lists.Type;

/** The key a folder's list is kept under. */
export const folderKey = (directory: string | undefined): string => directory ?? "";

const CHANGED: ReadonlySet<string> = new Set(["command.updated", "skill.updated"]);

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Lists);
  const http = yield* HttpClient.HttpClient;
  const opencode = yield* Opencode;
  const lists = yield* SubscriptionRef.make<Lists>({});

  const keep = (next: Lists) => store.set(STORE_KEY, next).pipe(Effect.catch((error) => Effect.logError("[commands] keeping the lists failed", error)));

  /** Fetches one folder's list from `server`. */
  const refresh = (server: string, directory: string | undefined) =>
    Effect.gen(function* () {
      const query = directory === undefined ? "" : `?directory=${encodeURIComponent(directory)}`;
      const list = yield* http.get(`${server}${Commands.path}${query}`).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Commands.List)),
      );
      const next = yield* SubscriptionRef.updateAndGet(lists, (all) => ({ ...all, [folderKey(directory)]: list }));
      yield* keep(next);
    }).pipe(Effect.catch((error) => Effect.logWarning(`[commands] the list of ${directory ?? "the server"} could not be loaded`, error)));

  /** Fetches the known folders among `directories` again. */
  const refreshKnown = (server: string, directories: Iterable<string>) =>
    Effect.flatMap(SubscriptionRef.get(lists), (all) =>
      Effect.forEach(
        [...new Set(directories)].filter((directory) => directory in all),
        (directory) => refresh(server, directory),
        { concurrency: 2, discard: true },
      ),
    );

  /** Fetches a folder again whenever opencode says its commands or skills
   * changed. Runs until interrupted, connecting again when the stream drops. */
  const follow = (server: string, opencodeServer: ServerAddress) =>
    Effect.gen(function* () {
      const client = yield* opencode.client(opencodeServer);
      const events = yield* client["server.event"]["event.subscribe"]();
      yield* events.pipe(
        Stream.map((event): string | undefined => (CHANGED.has(event.type) ? event.location?.directory : undefined)),
        Stream.filter((directory): directory is string => directory !== undefined),
        Stream.groupedWithin(64, EVENT_WINDOW),
        Stream.runForEach((directories) => refreshKnown(server, directories)),
      );
    }).pipe(
      Effect.catchCause((cause) => Effect.logWarning("[commands] opencode's events dropped; connecting again", cause)),
      Effect.repeat(reconnect),
    );

  return {
    /** Every folder's list, as it changes. */
    changes: SubscriptionRef.changes(lists),
    /** Reads back the lists kept on the device (at launch). */
    readBack: store.get(STORE_KEY).pipe(
      Effect.map(Option.getOrElse((): Lists => ({}))),
      Effect.flatMap((kept) => SubscriptionRef.set(lists, kept)),
      Effect.catch((error) => Effect.logError("[commands] the kept lists could not be read", error)),
    ),
    /** Fetches one folder's list again. */
    refresh,
    /** Fetches every known folder's list again, and the server's own. */
    refreshAll: (server: string) =>
      Effect.flatMap(SubscriptionRef.get(lists), (all) =>
        Effect.forEach(
          [...new Set(["", ...Object.keys(all)])],
          (key) => refresh(server, key === "" ? undefined : key),
          { concurrency: 2, discard: true },
        ),
      ),
    follow,
  };
});

export class CommandCatalog extends Context.Service<CommandCatalog, Effect.Success<typeof make>>()("@doubleagent/CommandCatalog") {
  static readonly layer = Layer.effect(CommandCatalog, make);
}
