import { NodeServices } from "@effect/platform-node";
import { Duration, Effect, FileSystem, Layer, Option, Path, Queue, Scope, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { FileSync, TextChange } from "file-sync";
import { describe, expect, it } from "vitest";
import { FileHub } from "./hub";

/** A stand-in for opencode's `/global/event`: lines pushed by the test. */
const makeOpencode = () => {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const client = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(
          new ReadableStream<Uint8Array>({
            start: (opened) => {
              controller = opened;
            },
          }),
        ),
      ),
    ),
  );
  const send = (payload: unknown) =>
    Effect.sync(() => {
      controller?.enqueue(encoder.encode(`data: ${JSON.stringify({ directory: "/", payload })}\n`));
    });
  return {
    layer: Layer.succeed(HttpClient.HttpClient, client),
    send,
  };
};

/** Run `body` against a fresh hub over a temp folder holding `file.ts`. */
const withHub = <A, E>(
  body: (context: {
    readonly hub: FileHub["Service"];
    readonly file: string;
    readonly fs: FileSystem.FileSystem;
    readonly send: (payload: unknown) => Effect.Effect<void>;
  }) => Effect.Effect<A, E, FileHub | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();
    const root = yield* fs.realPath(dir);
    const file = path.join(root, "file.ts");
    yield* fs.writeFileString(file, "one\ntwo\nthree\n");
    process.env.AGENT_CONSOLE_FS_ROOT = root;
    const opencode = makeOpencode();
    return yield* Effect.gen(function* () {
      const hub = yield* FileHub;
      return yield* body({
        hub,
        file,
        fs,
        send: opencode.send,
      });
    }).pipe(Effect.provide(Layer.fresh(FileHub.layer).pipe(Layer.provide(opencode.layer))));
  }).pipe(
    Effect.ensuring(Effect.sync(() => delete process.env.AGENT_CONSOLE_FS_ROOT)),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

/** Follow `file`, handing back a queue of what arrives. */
const follow = (hub: FileHub["Service"], file: string) =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<FileSync.FileEvent>();
    yield* hub.follow(file).pipe(
      Stream.runForEach((event) => Queue.offer(events, event)),
      Effect.forkScoped,
    );
    return events;
  });

const next = (events: Queue.Queue<FileSync.FileEvent>) => Queue.take(events).pipe(Effect.timeout(Duration.seconds(3)));

/** Nothing more arrives for a while. */
const quiet = (events: Queue.Queue<FileSync.FileEvent>) =>
  Queue.take(events).pipe(
    Effect.timeoutOption(Duration.millis(600)),
    Effect.map(Option.isNone),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("file hub", () => {
  it("syncs, then sends an outside write as a change", () =>
    run(
      withHub(({ hub, file, fs }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          const synced = yield* next(events);
          expect(synced).toBeInstanceOf(FileSync.Synced);
          if (!(synced instanceof FileSync.Synced)) return;
          expect(synced.version).toBe(0);
          expect(synced.text).toBe("one\ntwo\nthree\n");

          yield* fs.writeFileString(file, "one\n2\nthree\n");
          const changed = yield* next(events);
          expect(changed).toBeInstanceOf(FileSync.Changed);
          if (!(changed instanceof FileSync.Changed)) return;
          expect(changed.version).toBe(1);
          expect(changed.author).toBeInstanceOf(FileSync.External);
          expect(TextChange.apply(synced.text, changed.changes)).toBe("one\n2\nthree\n");
        }),
      ),
    ));

  it("accepts a write on the current version, once, and refuses one on an old version", () =>
    run(
      withHub(({ hub, file, fs }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          const synced = yield* next(events);
          if (!(synced instanceof FileSync.Synced)) return expect(synced).toBeInstanceOf(FileSync.Synced);
          const request = (baseVersion: number, text: string) =>
            new FileSync.WriteRequest({
              path: file,
              clientID: "phone",
              epoch: synced.epoch,
              baseVersion,
              changes: TextChange.diff(synced.text, text),
            });

          const accepted = yield* hub.write(request(0, "one\ntwo\nthree\nfour\n"));
          expect(accepted).toEqual(new FileSync.Accepted({ version: 1 }));
          expect(yield* fs.readFileString(file)).toBe("one\ntwo\nthree\nfour\n");
          const changed = yield* next(events);
          if (!(changed instanceof FileSync.Changed)) return expect(changed).toBeInstanceOf(FileSync.Changed);
          expect(changed.author).toEqual(new FileSync.Client({ clientID: "phone" }));
          // The hub's own write coming back through the watcher is not a change.
          expect(yield* quiet(events)).toBe(true);

          const stale = yield* hub.write(request(0, "zero\n"));
          expect(stale).toEqual(new FileSync.Stale({ version: 1 }));
          expect(yield* fs.readFileString(file)).toBe("one\ntwo\nthree\nfour\n");
        }),
      ),
    ));

  it("refuses a write when the disk changed and the watcher has not said so yet", () =>
    run(
      withHub(({ hub, file, fs }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          const synced = yield* next(events);
          if (!(synced instanceof FileSync.Synced)) return expect(synced).toBeInstanceOf(FileSync.Synced);
          yield* fs.writeFileString(file, "agent wrote this\n");
          const result = yield* hub.write(
            new FileSync.WriteRequest({
              path: file,
              clientID: "phone",
              epoch: synced.epoch,
              baseVersion: 0,
              changes: TextChange.diff(synced.text, "one\n"),
            }),
          );
          expect(result).toEqual(new FileSync.Stale({ version: 1 }));
          expect(yield* fs.readFileString(file)).toBe("agent wrote this\n");
        }),
      ),
    ));

  it("refuses a write from an earlier run of the hub", () =>
    run(
      withHub(({ hub, file }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          yield* next(events);
          const result = yield* hub.write(
            new FileSync.WriteRequest({
              path: file,
              clientID: "phone",
              epoch: "an-old-run",
              baseVersion: 0,
              changes: [],
            }),
          );
          expect(result).toEqual(new FileSync.Stale({ version: 0 }));
        }),
      ),
    ));

  it("names the agent session whose tool call wrote the file", () =>
    run(
      withHub(({ hub, file, fs, send }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          yield* next(events);
          yield* send({
            type: "message.part.updated",
            properties: {
              part: {
                id: "prt_1",
                type: "tool",
                tool: "edit",
                sessionID: "ses_agent",
                state: {
                  status: "running",
                  input: {
                    filePath: file,
                  },
                  time: {
                    start: 1,
                  },
                },
              },
            },
          });
          // Let the hub read the event before the write lands.
          yield* Effect.sleep(Duration.millis(100));
          yield* fs.writeFileString(file, "one\ntwo\nTHREE\n");
          const changed = yield* next(events);
          if (!(changed instanceof FileSync.Changed)) return expect(changed).toBeInstanceOf(FileSync.Changed);
          expect(changed.author).toEqual(new FileSync.Agent({ sessionID: "ses_agent" }));
        }),
      ),
    ));

  it("credits an agent for a file.edited with no tool call seen", () =>
    run(
      withHub(({ hub, file, fs, send }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          yield* next(events);
          yield* fs.writeFileString(file, "rewritten\n");
          yield* send({
            type: "file.edited",
            properties: {
              file,
            },
          });
          const changed = yield* next(events);
          if (!(changed instanceof FileSync.Changed)) return expect(changed).toBeInstanceOf(FileSync.Changed);
          expect(changed.author).toEqual(new FileSync.Agent({ sessionID: undefined }));
        }),
      ),
    ));

  it("sends a delete, then the file's return as a change", () =>
    run(
      withHub(({ hub, file, fs }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          yield* next(events);
          yield* fs.remove(file);
          expect(yield* next(events)).toEqual(new FileSync.Deleted({ version: 1 }));
          yield* fs.writeFileString(file, "back\n");
          const changed = yield* next(events);
          if (!(changed instanceof FileSync.Changed)) return expect(changed).toBeInstanceOf(FileSync.Changed);
          expect(changed.version).toBe(2);
          expect(TextChange.apply("one\ntwo\nthree\n", changed.changes)).toBe("back\n");
        }),
      ),
    ));

  it("follows a file saved by replacing it (write to a temp file, rename over)", () =>
    run(
      withHub(({ hub, file, fs }) =>
        Effect.gen(function* () {
          const events = yield* follow(hub, file);
          yield* next(events);
          yield* fs.writeFileString(`${file}.tmp`, "replaced\n");
          yield* fs.rename(`${file}.tmp`, file);
          const changed = yield* next(events);
          if (!(changed instanceof FileSync.Changed)) return expect(changed).toBeInstanceOf(FileSync.Changed);
          expect(TextChange.apply("one\ntwo\nthree\n", changed.changes)).toBe("replaced\n");
        }),
      ),
    ));

  it("refuses a file outside the root", () =>
    run(
      withHub(({ hub }) =>
        hub.follow("/etc/hosts").pipe(
          Stream.runHead,
          Effect.flip,
          Effect.map((error) => expect(error.reason).toBe("NotFound")),
        ),
      ),
    ));
});
