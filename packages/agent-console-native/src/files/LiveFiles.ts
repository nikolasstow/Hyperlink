/**
 * Files kept in step with the file hub (the API server's `/files/sync`), so
 * a file open in the app shows an agent's edit the moment it lands, and our
 * edits reach the disk without ever writing over a change we have not seen.
 *
 * - **Followed:** every file open in a Files tab or kept on the device, and
 *   any file on screen (`follow`). Followed before anyone taps, so a file an
 *   agent changed in the background is already current when opened.
 * - **Received:** each change the hub sends is folded in by `liveFile.ts`
 *   (our edits rebased onto it; where it meets one of ours, the hub's text is
 *   kept and ours is held as a conflict), the device copies are updated, and
 *   an open editor is handed the change to apply in place (`updates`).
 * - **Written:** `save` sends our edits against the version they were made
 *   on. Refused as stale, it waits for the change it missed and tries again.
 *
 * One WebSocket per API server, multiplexing every followed file; followed
 * files resync themselves after a dropped connection.
 * Decisions: docs/handoffs/live-file-sync.md.
 *
 * @internal
 */
import { Clock, Context, Data, Duration, Effect, FiberMap, HashMap, Layer, Option, PubSub, Random, RcMap, Ref, Schedule, Semaphore, Stream, SubscriptionRef } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { Socket } from "effect/unstable/socket";
import { FileSync } from "file-sync";
import { DeviceSignals } from "../effect/DeviceSignals";
import { autosaveSettingsNow, resolveAutosave } from "./autosaveSettings";
import { getFileEdit, setFileEdit, clearFileEdit } from "./fileEdits";
import { getFileText, setFileText } from "./fileTextCache";
import * as LiveFile from "./liveFile";

/** Why a followed file has no text from the hub: the hub refused it
 * (`NotFound`, `TooLarge`, …) or could not be reached. */
export type LiveFileProblem = FileSync.FileSyncError["reason"] | "Unreachable";

/** A change an open editor must apply. */
export interface LiveFileUpdate {
  readonly path: string;
  readonly update: LiveFile.EditorUpdate;
}

/** How long a server's connection stays open after its last file is let go. */
const KEEP_CONNECTION = Duration.seconds(30);
/** Between attempts to follow a file again after its stream failed. */
const REFOLLOW = Schedule.spaced(Duration.seconds(2));

/** `[live]` debug logging is very chatty — several lines per file event — and
 * each console.log crosses the RN bridge, which stalls JS under load (a retry
 * storm over a large follow scope logs thousands of lines). Off by default;
 * flip to trace a sync issue. The real fix for the storm (not following huge /
 * unopened trees) is in the follow scope — see docs/handoffs/live-file-sync.md. */
const LIVE_LOG = false;
const liveLog = (...args: ReadonlyArray<unknown>): void => {
  if (LIVE_LOG) console.log(...args);
};

/** Raised to follow a file again: the hub's changes skipped a version. */
class OutOfStep extends Data.TaggedError("OutOfStep")<{
  readonly path: string;
}> {}

/** A connection: its server and the generation it belongs to, as one key. */
const connectionKey = (api: string, generation: number): string => `${generation}#${api}`;
const apiOfKey = (key: string): string => key.slice(key.indexOf("#") + 1);

const socketUrl = (api: string): string => `${api.replace(/^http/, "ws")}${FileSync.path}`;

const connect = (api: string) =>
  Effect.gen(function* () {
    // DIAG(live-files): temporary.
    yield* Effect.sync(() => liveLog("[live] connect", socketUrl(api)));
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
        Layer.provide(Socket.layerWebSocket(socketUrl(api))),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      ),
    );
    return yield* RpcClient.make(FileSync.FileSyncRpcs).pipe(Effect.provideContext(protocol));
  });

const make = Effect.gen(function* () {
  // Tells our writes coming back from the hub from everyone else's.
  const startedAt = yield* Clock.currentTimeMillis;
  const salt = yield* Random.nextInt;
  const clientID = `app-${startedAt.toString(36)}-${Math.abs(salt).toString(36)}`;

  const files = yield* SubscriptionRef.make(HashMap.empty<string, LiveFile.LiveFile>());
  const problems = yield* SubscriptionRef.make(HashMap.empty<string, LiveFileProblem>());
  const updates = yield* PubSub.unbounded<LiveFileUpdate>();
  const saved = yield* PubSub.unbounded<string>();
  /** Files whose edits should be written as soon as the hub allows. */
  const wanted = yield* Ref.make<ReadonlySet<string>>(new Set());
  const writing = yield* Ref.make<ReadonlySet<string>>(new Set());
  /** The API server the files are followed on. */
  const server = yield* Ref.make<string | undefined>(undefined);
  // One change at a time across all files: the folds are quick and pure.
  const lock = yield* Semaphore.make(1);
  // Keyed by server and generation: coming back to the foreground starts a new
  // generation (a fresh connection); the old one closes once nothing uses it.
  const connections = yield* RcMap.make({
    lookup: (key: string) => connect(apiOfKey(key)),
    idleTimeToLive: KEEP_CONNECTION,
  });
  const generation = yield* Ref.make(0);
  const connection = (api: string) =>
    Ref.get(generation).pipe(Effect.flatMap((current) => RcMap.get(connections, connectionKey(api, current))));
  const follows = yield* FiberMap.make<string>();
  const followed = yield* Ref.make<ReadonlySet<string>>(new Set());
  const device = yield* DeviceSignals;

  const fileOf = (path: string) => SubscriptionRef.get(files).pipe(Effect.map((map) => HashMap.get(map, path)));

  /** Store `file`, keep the device copies in step, and hand an open editor its change. */
  const put = (path: string, file: LiveFile.LiveFile, editor: LiveFile.EditorUpdate | undefined) =>
    Effect.gen(function* () {
      yield* SubscriptionRef.update(files, HashMap.set(path, file));
      yield* Effect.sync(() => {
        setFileText(path, file.base);
        if (file.text === file.base) clearFileEdit(path);
        else setFileEdit(path, file.text);
      });
      if (editor !== undefined) {
        yield* PubSub.publish(updates, {
          path,
          update: editor,
        });
      }
    });

  const write = (path: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const api = yield* Ref.get(server);
      if (api === undefined) return;
      const start = yield* Effect.gen(function* () {
        const busy = yield* Ref.get(writing);
        const file = yield* fileOf(path);
        if (busy.has(path) || Option.isNone(file) || file.value.deleted) return Option.none();
        const changes = LiveFile.pendingWrite(file.value);
        if (changes.length === 0) {
          yield* Ref.update(wanted, (set) => without(set, path));
          return Option.none();
        }
        yield* Ref.update(writing, (set) => new Set(set).add(path));
        return Option.some({
          file: file.value,
          changes,
        });
      }).pipe(Semaphore.withPermits(lock, 1));
      if (Option.isNone(start)) return;
      const { file, changes } = start.value;
      // DIAG(live-files): temporary — every write, and what it sends.
      yield* Effect.sync(() => liveLog("[live] writing", path.split("/").pop(), "base v", file.version, JSON.stringify(changes)));
      const result = yield* connection(api).pipe(
        Effect.flatMap((client) =>
          client.Write(
            new FileSync.WriteRequest({
              path,
              clientID,
              epoch: file.epoch,
              baseVersion: file.version,
              changes,
            }),
          ),
        ),
        Effect.scoped,
        Effect.option,
      );
      const again = yield* Effect.gen(function* () {
        yield* Ref.update(writing, (set) => without(set, path));
        if (Option.isNone(result)) return false;
        if (result.value instanceof FileSync.Stale) return false;
        const current = yield* fileOf(path);
        if (Option.isNone(current)) return false;
        const next = LiveFile.accepted(current.value, changes, result.value.version);
        yield* put(path, next, undefined);
        yield* PubSub.publish(saved, path);
        const still = LiveFile.pendingWrite(next).length > 0;
        if (!still) yield* Ref.update(wanted, (set) => without(set, path));
        const wantedNow = yield* Ref.get(wanted);
        return still && wantedNow.has(path);
      }).pipe(Semaphore.withPermits(lock, 1));
      if (Option.isNone(result)) yield* Effect.logWarning(`live files: writing ${path} failed; will retry`);
      if (again) yield* write(path);
    });

  /** After any change from the hub, a wanted write may go now. */
  const writeIfWanted = (path: string) =>
    Ref.get(wanted).pipe(Effect.flatMap((set) => (set.has(path) ? Effect.forkDetach(write(path)) : Effect.void)));

  const receive = (path: string, event: FileSync.FileEvent) =>
    Effect.gen(function* () {
      // DIAG(live-files): temporary.
      yield* Effect.sync(() => liveLog("[live] event", path, event._tag));
      const current = yield* fileOf(path);
      if (event instanceof FileSync.Synced) {
        // DIAG(live-files): temporary.
        yield* Effect.sync(() => liveLog("[live] reading kept copy", path.split("/").pop()));
        const kept = Option.isSome(current) ? nothingKept : yield* keptOnDevice(path);
        yield* Effect.sync(() => liveLog("[live] kept copy read", path.split("/").pop(), kept.base?.length, kept.edit?.length));
        const received = LiveFile.synced(Option.getOrUndefined(current), kept, event);
        yield* put(path, received.file, received.editor);
        yield* SubscriptionRef.update(problems, HashMap.remove(path));
        // Edits made while away (or kept from before a restart) go out now,
        // where autosave is on for the file; elsewhere they wait for a save.
        const autosave = yield* Effect.sync(() => resolveAutosave(autosaveSettingsNow(), { path }));
        if (autosave && LiveFile.pendingWrite(received.file).length > 0) yield* Ref.update(wanted, (set) => new Set(set).add(path));
        return;
      }
      if (Option.isNone(current)) return;
      if (event instanceof FileSync.Deleted) {
        yield* put(path, LiveFile.deleted(current.value, event), undefined);
        return;
      }
      const received = LiveFile.changed(current.value, event, clientID);
      if (received === undefined) return yield* new OutOfStep({ path });
      // DIAG(live-files): temporary — did our edits clash with it?
      yield* Effect.sync(() =>
        liveLog("[live] change folded", path.split("/").pop(), "had edits", current.value.text !== current.value.base, "conflicts", received.file.conflicts.length),
      );
      yield* put(path, received.file, received.editor);
    }).pipe(
      Semaphore.withPermits(lock, 1),
      // DIAG(live-files): temporary.
      Effect.tap(() => Effect.sync(() => liveLog("[live] handled", path.split("/").pop(), event._tag))),
      Effect.andThen(writeIfWanted(path)),
    );

  const followOn = (api: string, path: string) =>
    Effect.sync(() => liveLog("[live] following", api, path)).pipe(
      Effect.andThen(connection(api)),
      Effect.flatMap((client) =>
        client.Follow({ path }).pipe(
          // DIAG(live-files): temporary — arrival, before waiting for the lock.
          Stream.tap((event) => Effect.sync(() => liveLog("[live] arrived", path.split("/").pop(), event._tag))),
          Stream.runForEach((event) => receive(path, event)),
        ),
      ),
      Effect.scoped,
      Effect.tapError((error) => Effect.sync(() => liveLog("[live] follow failed", path, String(error)))),
      Effect.tapError((error) =>
        SubscriptionRef.update(problems, HashMap.set(path, error._tag === "FileSyncError" ? error.reason : error._tag === "OutOfStep" ? "Io" : "Unreachable")).pipe(
          Effect.andThen(Effect.logWarning(`live files: following ${path} stopped; following again`, error)),
        ),
      ),
      // Retry only TRANSIENT failures (a dropped connection, an OutOfStep that
      // resyncs). A FileSyncError is the hub permanently rejecting the path
      // (e.g. following a directory or a too-large/absent file); retrying it
      // every 2s forever is a storm that stalls JS app-wide. Stop on it — the
      // path is re-followed on the next foreground/online or access instead.
      Effect.retry({ schedule: REFOLLOW, while: (error) => error._tag !== "FileSyncError" }),
      // The hub ended the stream (it should not): follow again.
      Effect.repeat(REFOLLOW),
    );

  // Back in the foreground (or online), follow every file afresh: iOS pauses a
  // backgrounded app's connection, so changes made meanwhile never arrived.
  // A fresh follow syncs each file at once, rather than after the connection
  // check notices the old one is gone.
  yield* device.signals.pipe(
    Stream.filter((signal) => signal === "foreground" || signal === "online"),
    Stream.runForEach(() =>
      Effect.gen(function* () {
        const api = yield* Ref.get(server);
        if (api === undefined) return;
        const paths = yield* Ref.get(followed);
        yield* Ref.update(generation, (current) => current + 1);
        for (const path of paths) {
          yield* FiberMap.run(follows, path, followOn(api, path));
        }
      }),
    ),
    Effect.forkScoped,
  );

  return {
    /**
     * Follow exactly `paths` on the API server `api` (files open in tabs,
     * kept on the device, or on screen). Files no longer listed are let go;
     * a new server starts over.
     */
    follow: (api: string, paths: ReadonlySet<string>) =>
      Effect.gen(function* () {
        const previous = yield* Ref.getAndSet(server, api);
        const running = yield* Ref.getAndSet(followed, paths);
        if (previous !== api) yield* FiberMap.clear(follows);
        for (const path of running) {
          if (!paths.has(path)) yield* FiberMap.remove(follows, path);
        }
        for (const path of paths) {
          yield* FiberMap.run(follows, path, followOn(api, path), { onlyIfMissing: true });
        }
      }),
    /** The file as the app has it, if followed. */
    file: fileOf,
    /** Typing in an open editor. */
    edit: (path: string, text: string) =>
      Effect.gen(function* () {
        const current = yield* fileOf(path);
        if (Option.isNone(current)) return;
        yield* SubscriptionRef.update(files, HashMap.set(path, LiveFile.edited(current.value, text)));
      }).pipe(Semaphore.withPermits(lock, 1)),
    /** Write the file's edits to disk, as soon as the hub allows. */
    save: (path: string) => Ref.update(wanted, (set) => new Set(set).add(path)).pipe(Effect.andThen(write(path))),
    /** Settle a conflict: keep the outside change, or put ours back. */
    resolve: (path: string, index: number, keep: "Mine" | "Theirs") =>
      Effect.gen(function* () {
        const current = yield* fileOf(path);
        if (Option.isNone(current)) return;
        const received = LiveFile.resolve(current.value, index, keep);
        yield* put(path, received.file, received.editor);
        if (keep === "Mine") yield* Ref.update(wanted, (set) => new Set(set).add(path));
      }).pipe(Semaphore.withPermits(lock, 1), Effect.andThen(writeIfWanted(path))),
    /** Every followed file, as it changes. */
    changes: SubscriptionRef.changes(files),
    /** Followed files the hub has not sent, and why. */
    problems: SubscriptionRef.changes(problems),
    /** Changes open editors must apply. */
    updates: Stream.fromPubSub(updates),
    /** Files just written to disk (for the save light). */
    saved: Stream.fromPubSub(saved),
  };
});

const nothingKept: LiveFile.Kept = {
  base: undefined,
  edit: undefined,
};

/** What the device kept of a file from before (a restart, a dropped connection). */
const keptOnDevice = (path: string) =>
  Effect.all({
    base: Effect.promise(() => getFileText(path)),
    edit: Effect.promise(() => getFileEdit(path)),
  });

const without = (set: ReadonlySet<string>, path: string): ReadonlySet<string> => {
  if (!set.has(path)) return set;
  const next = new Set(set);
  next.delete(path);
  return next;
};

export class LiveFiles extends Context.Service<LiveFiles, Effect.Success<typeof make>>()("@doubleagent/files/LiveFiles") {
  static readonly layer = Layer.effect(LiveFiles, make);
}
