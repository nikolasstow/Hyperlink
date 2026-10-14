/**
 * The file hub: the one place a followed file's version lives.
 *
 * Every app editing a file follows it here. The hub watches the file on
 * disk, and when anything writes it (an agent, another editor, git) it diffs
 * the new text against the last and sends the change, with who made it, to
 * every follower. Apps write through the hub with the version their edits
 * were made against; a write against an old version is refused (`Stale`) and
 * the app rebases and writes again. So no write ever lands over a change its
 * writer has not seen. Protocol: `file-sync/FileSync`.
 *
 * Who made a disk change comes from opencode's event stream: an edit/write
 * tool call running on the file, or a `file.edited` just before. Anything else
 * is `External`.
 *
 * Followed files are kept (text, version, watcher) while anyone follows them,
 * and a short while after.
 *
 * @internal
 */
import { Clock, Config, Context, Duration, Effect, FileSystem, Layer, Option, Path, PubSub, Random, RcMap, Ref, Schedule, Schema, Semaphore, Stream } from "effect";
import { HttpClient } from "effect/http";
import { FileSync, TextChange } from "file-sync";
import { FsError, MAX_READ_BYTES, resolveWithin } from "../fs";

/** Quiet time after a disk event before reading the file: one read for a burst
 * of writes (an agent's write, then its formatter's). */
const SETTLE = Duration.millis(150);
/** How long a followed file stays kept after its last follower leaves. */
const KEEP_IDLE = Duration.seconds(30);
/** A `file.edited` or finished tool call this recent names the writer. */
const AGENT_WINDOW_MS = 3_000;

interface FileState {
  readonly version: number;
  readonly text: string;
  readonly exists: boolean;
}

interface Entry {
  readonly path: string;
  readonly state: Ref.Ref<FileState>;
  readonly lock: Semaphore.Semaphore;
  readonly events: PubSub.PubSub<FileSync.FileEvent>;
}

/** An agent's tool call on a file: running until it completes. */
interface ToolMark {
  readonly sessionID: string;
  readonly running: boolean;
  readonly at: number;
}

const reasonOf = (error: FsError): FileSync.FileSyncError["reason"] => {
  switch (error.reason) {
    case "not-found":
    case "outside-root":
      return "NotFound";
    case "not-a-file":
    case "not-a-directory":
      return "NotAFile";
    case "too-large":
      return "TooLarge";
    case "io":
      return "Io";
  }
};

const syncError = (error: FsError) =>
  new FileSync.FileSyncError({
    reason: reasonOf(error),
    path: error.path,
  });

/** The `/global/event` lines the hub reads; the rest are skipped. */
const opencodeEvent = Schema.Struct({
  payload: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("file.edited"),
      properties: Schema.Struct({
        file: Schema.String,
      }),
    }),
    Schema.Struct({
      type: Schema.Literal("message.part.updated"),
      properties: Schema.Struct({
        part: Schema.Struct({
          type: Schema.Literal("tool"),
          sessionID: Schema.String,
          state: Schema.Struct({
            status: Schema.String,
            input: Schema.Record(Schema.String, Schema.Unknown),
          }),
        }),
      }),
    }),
  ]),
});
const decodeOpencodeEvent = Schema.decodeUnknownResult(Schema.fromJsonString(opencodeEvent));

/** The file a tool call's input names, as opencode's tools spell it. */
const toolFile = (input: Readonly<Record<string, unknown>>): string | undefined => {
  for (const key of ["filePath", "file_path", "path"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return undefined;
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const opencodeUrl = yield* Config.String("AGENT_CONSOLE_OPENCODE_URL").pipe(Config.withDefault("http://127.0.0.1:4096"));
  // Tells this run of the hub from the last, whose versions mean nothing now.
  const startedAt = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextInt;
  const epoch = `${startedAt.toString(36)}-${salt.toString(36)}`;

  /** Tool calls on files, by real path. */
  const toolMarks = yield* Ref.make<ReadonlyMap<string, ToolMark>>(new Map());
  /** When opencode last said it edited a file, by real path. */
  const editedMarks = yield* Ref.make<ReadonlyMap<string, number>>(new Map());

  const realPath = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => path.resolve(file)));

  const authorOf = (file: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const tools = yield* Ref.get(toolMarks);
      const edited = yield* Ref.get(editedMarks);
      const tool = tools.get(file);
      const toolWrote = tool !== undefined && (tool.running || now - tool.at < AGENT_WINDOW_MS);
      const editedAt = edited.get(file);
      if (toolWrote || (editedAt !== undefined && now - editedAt < AGENT_WINDOW_MS)) {
        return new FileSync.Agent({
          sessionID: toolWrote ? tool.sessionID : undefined,
        });
      }
      return new FileSync.External({});
    });

  /** The file's text, or none when it is gone. */
  const readText = (file: string) =>
    fs.stat(file).pipe(
      Effect.option,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: (info) => {
            if (info.type !== "File") return Effect.fail(new FsError({ reason: "not-a-file", path: file }));
            if (Number(info.size) > MAX_READ_BYTES) return Effect.fail(new FsError({ reason: "too-large", path: file }));
            return fs.readFileString(file).pipe(
              Effect.map(Option.some),
              Effect.mapError(() => new FsError({ reason: "io", path: file })),
            );
          },
        }),
      ),
    );

  /** Take in whatever is on disk now; send it as a change if it is one. Call
   * holding the entry's lock. */
  const ingest = (entry: Entry) =>
    Effect.gen(function* () {
      const state = yield* Ref.get(entry.state);
      const text = yield* readText(entry.path);
      if (Option.isNone(text)) {
        if (!state.exists) return;
        const version = state.version + 1;
        yield* Ref.set(entry.state, {
          version,
          text: state.text,
          exists: false,
        });
        yield* PubSub.publish(entry.events, new FileSync.Deleted({ version }));
        return;
      }
      if (state.exists && text.value === state.text) return;
      const author = yield* authorOf(entry.path);
      const version = state.version + 1;
      yield* Ref.set(entry.state, {
        version,
        text: text.value,
        exists: true,
      });
      yield* PubSub.publish(
        entry.events,
        new FileSync.Changed({
          version,
          changes: TextChange.diff(state.text, text.value),
          author,
        }),
      );
    });

  const ingestLocked = (entry: Entry) =>
    ingest(entry).pipe(
      Semaphore.withPermits(entry.lock, 1),
      Effect.catch((error) => Effect.logWarning(`file hub: couldn't read ${entry.path} (${error.reason})`)),
    );

  /** Watch the file's folder (survives saves that replace the file), reading
   * the file once each burst of events settles. */
  const watch = (entry: Entry) =>
    fs.watch(path.dirname(entry.path)).pipe(
      Stream.filter((event) => path.basename(event.path) === path.basename(entry.path)),
      Stream.debounce(SETTLE),
      Stream.runForEach(() => ingestLocked(entry)),
      Effect.tapError((error) => Effect.logWarning(`file hub: watching ${entry.path} failed, retrying`, error)),
      Effect.retry(Schedule.spaced(Duration.seconds(2))),
    );

  const entries = yield* RcMap.make({
    lookup: (file: string) =>
      Effect.gen(function* () {
        const text = yield* readText(file).pipe(Effect.mapError(syncError));
        if (Option.isNone(text)) return yield* new FileSync.FileSyncError({ reason: "NotFound", path: file });
        const entry: Entry = {
          path: file,
          state: yield* Ref.make<FileState>({
            version: 0,
            text: text.value,
            exists: true,
          }),
          lock: yield* Semaphore.make(1),
          events: yield* PubSub.unbounded<FileSync.FileEvent>(),
        };
        yield* Effect.forkScoped(watch(entry));
        return entry;
      }),
    idleTimeToLive: KEEP_IDLE,
  });

  const resolve = (requested: string) =>
    resolveWithin(requested).pipe(
      Effect.mapError(syncError),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  /** opencode's events, for who wrote a file. Reconnects; never ends. */
  const listen = http.get(`${opencodeUrl}/global/event`).pipe(
    Effect.map((response) => response.stream),
    Stream.unwrap,
    Stream.decodeText,
    Stream.splitLines,
    Stream.filter((line) => line.startsWith("data: ")),
    Stream.filterMap((line) => decodeOpencodeEvent(line.slice(6))),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const { payload } = event;
        if (payload.type === "file.edited") {
          const file = yield* realPath(payload.properties.file);
          yield* Ref.update(editedMarks, (marks) => new Map(marks).set(file, now));
          return;
        }
        const { part } = payload.properties;
        const named = toolFile(part.state.input);
        if (named === undefined) return;
        const file = yield* realPath(named);
        yield* Ref.update(toolMarks, (marks) =>
          new Map(marks).set(file, {
            sessionID: part.sessionID,
            running: part.state.status === "pending" || part.state.status === "running",
            at: now,
          }),
        );
      }),
    ),
    Effect.tapError((error) => Effect.logWarning("file hub: opencode event stream dropped, reconnecting", error)),
    Effect.retry(Schedule.spaced(Duration.seconds(2))),
    Effect.andThen(Effect.logWarning("file hub: opencode event stream ended, reconnecting")),
    Effect.repeat(Schedule.spaced(Duration.seconds(2))),
  );
  yield* Effect.forkScoped(listen);

  const follow = (requested: string): Stream.Stream<FileSync.FileEvent, FileSync.FileSyncError> =>
    Effect.gen(function* () {
      const file = yield* resolve(requested);
      const entry = yield* RcMap.get(entries, file);
      // Subscribe, catch up with the disk and snapshot in one step, so the
      // follower gets every change after its `Synced` and none twice.
      const [subscription, state] = yield* Effect.gen(function* () {
        const subscribed = yield* PubSub.subscribe(entry.events);
        yield* ingest(entry).pipe(Effect.mapError(syncError));
        const current = yield* Ref.get(entry.state);
        return [subscribed, current] as const;
      }).pipe(Semaphore.withPermits(entry.lock, 1));
      return Stream.succeed(
        new FileSync.Synced({
          epoch,
          version: state.version,
          text: state.text,
        }),
      ).pipe(Stream.concat(Stream.fromSubscription(subscription)));
    }).pipe(Stream.unwrap);

  const write = (request: FileSync.WriteRequest): Effect.Effect<FileSync.WriteResult, FileSync.FileSyncError> =>
    Effect.gen(function* () {
      const file = yield* resolve(request.path);
      const entry = yield* RcMap.get(entries, file);
      return yield* Effect.gen(function* () {
        // Whatever reached the disk since the last event counts first.
        yield* ingest(entry).pipe(Effect.mapError(syncError));
        const state = yield* Ref.get(entry.state);
        if (!state.exists) return yield* new FileSync.FileSyncError({ reason: "NotFound", path: request.path });
        if (request.epoch !== epoch || request.baseVersion !== state.version) {
          return new FileSync.Stale({ version: state.version });
        }
        if (!TextChange.isValid(state.text.length, request.changes)) {
          return yield* new FileSync.FileSyncError({ reason: "InvalidChanges", path: request.path });
        }
        const text = TextChange.apply(state.text, request.changes);
        if (new TextEncoder().encode(text).length > MAX_READ_BYTES) {
          return yield* new FileSync.FileSyncError({ reason: "TooLarge", path: request.path });
        }
        yield* fs.writeFileString(file, text).pipe(Effect.mapError(() => new FileSync.FileSyncError({ reason: "Io", path: request.path })));
        const version = state.version + 1;
        yield* Ref.set(entry.state, {
          version,
          text,
          exists: true,
        });
        yield* PubSub.publish(
          entry.events,
          new FileSync.Changed({
            version,
            changes: request.changes,
            author: new FileSync.Client({ clientID: request.clientID }),
          }),
        );
        return new FileSync.Accepted({ version });
      }).pipe(Semaphore.withPermits(entry.lock, 1));
    }).pipe(Effect.scoped);

  return {
    follow,
    write,
  };
});

/** The hub. Needs an `HttpClient` to reach opencode (`FetchHttpClient.layer`). */
export class FileHub extends Context.Service<FileHub, Effect.Success<typeof make>>()("agent-console/server/files/hub/FileHub") {
  static readonly layer = Layer.effect(FileHub, make);
}
