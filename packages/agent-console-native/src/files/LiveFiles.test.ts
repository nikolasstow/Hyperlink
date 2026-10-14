/**
 * The app's live files against a real file hub: the agent-console server's
 * `/files/sync` route over a real WebSocket, on a temp folder. Covers what the
 * phone does: follow, see an outside write, write ours, merge around an
 * outside write, and hold a conflict.
 */
import { createServer } from "node:http";
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Context, Duration, Effect, Fiber, FileSystem, HashMap, Layer, Logger, Option, Path, Queue, Schedule, Scope, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";
import { describe, expect, it, vi } from "vitest";
import { fileSyncLayer } from "../../../agent-console/src/server/files/rpc";
import { type DeviceSignal, DeviceSignals } from "../effect/DeviceSignals";
import { LiveFiles } from "./LiveFiles";

vi.mock("@react-native-async-storage/async-storage", () => {
  const stored = new Map<string, string>();
  return {
    default: {
      getItem: async (key: string) => stored.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        stored.set(key, value);
      },
      removeItem: async (key: string) => {
        stored.delete(key);
      },
      getAllKeys: async () => [...stored.keys()],
    },
  };
});

const PORT = 5300 + Math.floor(Math.random() * 500);
const api = `http://127.0.0.1:${PORT}`;

/** Wait until `check` holds for the followed file (or time out). */
const until = <A>(live: LiveFiles["Service"], path: string, check: (text: string, conflicts: number) => A | undefined) =>
  live.file(path).pipe(
    Effect.flatMap((file) => {
      const found = Option.isSome(file) ? check(file.value.text, file.value.conflicts.length) : undefined;
      return found === undefined ? Effect.fail("not yet") : Effect.succeed(found);
    }),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(5)),
  );

const untilDisk = (fs: FileSystem.FileSystem, file: string, text: string) =>
  fs.readFileString(file).pipe(
    Effect.filterOrFail((onDisk) => onDisk === text),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(5)),
  );

const withHub = <A, E>(
  body: (context: {
    readonly live: LiveFiles["Service"];
    readonly file: string;
    readonly fs: FileSystem.FileSystem;
    /** Send a device signal (the app coming back to the foreground, …). */
    readonly signal: (signal: DeviceSignal) => Effect.Effect<void>;
  }) => Effect.Effect<A, E, Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();
    const root = yield* fs.realPath(dir);
    const file = path.join(root, "notes.ts");
    yield* fs.writeFileString(file, "one\ntwo\nthree\n");
    process.env.AGENT_CONSOLE_FS_ROOT = root;
    // No opencode here: its event stream just keeps failing to connect.
    process.env.AGENT_CONSOLE_OPENCODE_URL = "http://127.0.0.1:59999";
    yield* Layer.launch(HttpRouter.serve(fileSyncLayer).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: PORT })))).pipe(Effect.forkScoped);
    // Built in this test's scope, so the service lives as long as the test.
    const signals = yield* Queue.unbounded<DeviceSignal>();
    const services = yield* Layer.build(LiveFiles.layer.pipe(Layer.provide(Layer.succeed(DeviceSignals)({ signals: Stream.fromQueue(signals) })), Layer.provide(FetchHttpClient.layer)));
    const live = Context.get(services, LiveFiles);
    yield* live.follow(api, new Set([file]));
    yield* until(live, file, (text) => (text === "one\ntwo\nthree\n" ? true : undefined));
    return yield* body({
      live,
      file,
      fs,
      signal: (signal) => Queue.offer(signals, signal).pipe(Effect.asVoid),
    });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("LiveFiles against the file hub", () => {
  it("shows an outside write and hands the open editor the change", () =>
    run(
      withHub(({ live, file, fs }) =>
        Effect.gen(function* () {
          const update = yield* live.updates.pipe(
            Stream.filter((event) => event.path === file),
            Stream.runHead,
            Effect.forkScoped,
          );
          yield* fs.writeFileString(file, "one\nTWO\nthree\n");
          yield* until(live, file, (text) => (text === "one\nTWO\nthree\n" ? true : undefined));
          const received = yield* Fiber.join(update);
          expect(Option.map(received, (event) => event.update.text)).toEqual(Option.some("one\nTWO\nthree\n"));
        }),
      ),
    ), 20_000);

  it("writes our edit to disk", () =>
    run(
      withHub(({ live, file, fs }) =>
        Effect.gen(function* () {
          yield* live.edit(file, "one\ntwo\nthree\nfour\n");
          yield* live.save(file);
          yield* untilDisk(fs, file, "one\ntwo\nthree\nfour\n");
        }),
      ),
    ), 20_000);

  it("keeps our unsaved edit on one line when an agent writes another, then saves both", () =>
    run(
      withHub(({ live, file, fs }) =>
        Effect.gen(function* () {
          yield* live.edit(file, "ONE\ntwo\nthree\n");
          yield* fs.writeFileString(file, "one\ntwo\nTHREE\n");
          yield* until(live, file, (text) => (text === "ONE\ntwo\nTHREE\n" ? true : undefined));
          yield* live.save(file);
          yield* untilDisk(fs, file, "ONE\ntwo\nTHREE\n");
        }),
      ),
    ), 20_000);

  it("keeps the agent's line on a clash, and puts ours back on Keep Mine", () =>
    run(
      withHub(({ live, file, fs }) =>
        Effect.gen(function* () {
          yield* live.edit(file, "one\nmine\nthree\n");
          yield* fs.writeFileString(file, "one\ntheirs\nthree\n");
          yield* until(live, file, (text, conflicts) => (text === "one\ntheirs\nthree\n" && conflicts === 1 ? true : undefined));
          // Theirs is on disk, untouched by our edit.
          yield* untilDisk(fs, file, "one\ntheirs\nthree\n");
          yield* live.resolve(file, 0, "Mine");
          yield* untilDisk(fs, file, "one\nmine\nthree\n");
          const kept = yield* live.file(file);
          expect(Option.map(kept, (current) => current.conflicts.length)).toEqual(Option.some(0));
        }),
      ),
    ), 20_000);

  it("a save made against an old version is retried after the change it missed", () =>
    run(
      withHub(({ live, file, fs }) =>
        Effect.gen(function* () {
          // The agent's write lands on disk; ours goes out before the hub's
          // watcher has said so. The hub refuses ours, sends the change, and
          // ours goes again on top of it.
          yield* fs.writeFileString(file, "zero\none\ntwo\nthree\n");
          yield* live.edit(file, "one\ntwo\nthree\nfour\n");
          yield* live.save(file);
          yield* untilDisk(fs, file, "zero\none\ntwo\nthree\nfour\n");
          const files = yield* live.changes.pipe(Stream.runHead);
          const current = Option.flatMap(files, HashMap.get(file));
          expect(Option.map(current, (state) => state.text)).toEqual(Option.some("zero\none\ntwo\nthree\nfour\n"));
        }),
      ),
    ), 20_000);

  it("follows every file afresh when the app comes back, and changes keep arriving", () =>
    run(
      withHub(({ live, file, fs, signal }) =>
        Effect.gen(function* () {
          yield* fs.writeFileString(file, "one\ntwo\nTHREE\n");
          yield* until(live, file, (text) => (text === "one\ntwo\nTHREE\n" ? true : undefined));
          yield* signal("foreground");
          // Re-followed: a change after it still reaches the app.
          yield* Effect.sleep(Duration.millis(300));
          yield* fs.writeFileString(file, "one\nTWO\nTHREE\n");
          yield* until(live, file, (text) => (text === "one\nTWO\nTHREE\n" ? true : undefined));
        }),
      ),
    ), 20_000);

  it("asks for a folder once, not every 2 s, and shows why", () => {
    const warnings: Array<string> = [];
    const logger = Logger.make(({ message }) => {
      warnings.push(JSON.stringify(message));
    });
    return run(
      withHub(({ live, file }) =>
        Effect.gen(function* () {
          const folder = file.slice(0, file.lastIndexOf("/"));
          yield* live.follow(api, new Set([file, folder]));
          // Two refollow spaces: a retry would have asked twice more.
          yield* Effect.sleep(Duration.millis(4500));
          const problems = yield* live.problems.pipe(Stream.take(1), Stream.runCollect);
          expect(Option.flatMap(Option.fromNullishOr(problems[0]), HashMap.get(folder))).toEqual(Option.some("NotAFile"));
          expect(warnings.filter((warning) => warning.includes(folder))).toHaveLength(1);
        }),
      ).pipe(Effect.provide(Logger.layer([logger]))),
    );
  }, 20_000);
});
