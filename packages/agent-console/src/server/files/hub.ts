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
 * Who made a disk change comes from opencode's (v2) event stream: a tool call
 * on the file, running or just ended. Anything else is `External`.
 *
 * Followed files are kept (text, version, watcher) while anyone follows them,
 * and a short while after.
 *
 * @internal
 */
import { Clock, Context, Duration, Effect, FileSystem, Layer, Option, Path, PubSub, Random, RcMap, Ref, Schedule, Schema, Semaphore, Stream } from "effect";
import { Headers, HttpClient } from "effect/http";
import { FileSync, TextChange } from "file-sync";
import { FsError, MAX_READ_BYTES, resolveWithin } from "../fs";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";

/** Quiet time after a disk event before reading the file: one read for a burst
 * of writes (an agent's write, then its formatter's). */
const SETTLE = Duration.millis(150);
/** How long a followed file stays kept after its last follower leaves. */
const KEEP_IDLE = Duration.seconds(30);
/** A tool call on the file that ended this recently names the writer. */
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

/** The `/api/event` events the hub reads (a tool call starting, and ending);
 * the rest are skipped. */
const opencodeEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("session.tool.called"),
    data: Schema.Struct({
      sessionID: Schema.String,
      id: Schema.String,
      input: Schema.Record(Schema.String, Schema.Unknown),
    }),
  }),
  Schema.Struct({
    type: Schema.Literals(["session.tool.success", "session.tool.failed"]),
    data: Schema.Struct({
      sessionID: Schema.String,
      id: Schema.String,
    }),
  }),
]);
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
  const opencode = yield* opencodeUrl;
  const password = yield* opencodePassword;
  // Tells this run of the hub from the last, whose versions mean nothing now.
  const startedAt = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextInt;
  const epoch = `${startedAt.toString(36)}-${salt.toString(36)}`;

  /** Tool calls on files, by real path. */
  const toolMarks = yield* Ref.make<ReadonlyMap<string, ToolMark>>(new Map());
  /** The file each running tool call is on, by call id. */
  const toolFiles = yield* Ref.make<ReadonlyMap<string, string>>(new Map());

  const realPath = (file: string) => fs.realPath(file).pipe(Effect.orElseSucceed(() => path.resolve(file)));

  const authorOf = (file: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const tools = yield* Ref.get(toolMarks);
      const tool = tools.get(file);
      if (tool !== undefined && (tool.running || now - tool.at < AGENT_WINDOW_MS)) {
        return new FileSync.Agent({
          sessionID: tool.sessionID,
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

  /** The files kept now, by path: what other features read of them (the
   * suggestions' context from open files). */
  const kept = new Map<string, Ref.Ref<FileState>>();
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
        kept.set(file, entry.state);
        yield* Effect.addFinalizer(() => Effect.sync(() => kept.delete(file)));
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
  const listen = http.get(`${opencode}/api/event`, { headers: withOpencodeAuth(Headers.empty, password) }).pipe(
    Effect.map((response) => response.stream),
    Stream.unwrap,
    Stream.decodeText,
    Stream.splitLines,
    Stream.filter((line) => line.startsWith("data: ")),
    Stream.filterMap((line) => decodeOpencodeEvent(line.slice(6))),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const { sessionID, id } = event.data;
        if (event.type === "session.tool.called") {
          const named = toolFile(event.data.input);
          if (named === undefined) return;
          const file = yield* realPath(named);
          yield* Ref.update(toolFiles, (files) => new Map(files).set(id, file));
          yield* Ref.update(toolMarks, (marks) => new Map(marks).set(file, { sessionID, running: true, at: now }));
          return;
        }
        const file = (yield* Ref.get(toolFiles)).get(id);
        if (file === undefined) return;
        yield* Ref.update(toolFiles, (files) => {
          const next = new Map(files);
          next.delete(id);
          return next;
        });
        yield* Ref.update(toolMarks, (marks) => new Map(marks).set(file, { sessionID, running: false, at: now }));
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

  /** The file's version once the hub has what is on disk now (an agent's
   * write may not have reached the watcher yet). */
  const version = (requested: string): Effect.Effect<number, FileSync.FileSyncError> =>
    Effect.gen(function* () {
      const file = yield* resolve(requested);
      const entry = yield* RcMap.get(entries, file);
      return yield* ingest(entry).pipe(
        Effect.mapError(syncError),
        Effect.andThen(Ref.get(entry.state)),
        Effect.map((state) => state.version),
        Semaphore.withPermits(entry.lock, 1),
      );
    }).pipe(Effect.scoped);

  return {
    follow,
    write,
    version,
    /** The text of every file followed now (or just let go), by path. */
    openFiles: Effect.suspend(() =>
      Effect.forEach([...kept.entries()], ([file, state]) => Ref.get(state).pipe(Effect.map((now) => ({ path: file, text: now.text, exists: now.exists })))),
    ).pipe(Effect.map((files) => files.filter((file) => file.exists).map(({ path: file, text }) => ({ path: file, text })))),
  };
});

/** The hub. Needs an `HttpClient` to reach opencode (`FetchHttpClient.layer`). */
export class FileHub extends Context.Service<FileHub, Effect.Success<typeof make>>()("agent-console/server/files/hub/FileHub") {
  static readonly layer = Layer.effect(FileHub, make);
}
