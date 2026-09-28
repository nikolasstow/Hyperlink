/**
 * The process runner: runs what the app asks for (a package script, an
 * install) on this machine, and streams its output to whoever is watching.
 *
 * It is reachable from the network, so it runs only:
 *   - a program on the allowlist (package managers and the tools around them),
 *   - with its arguments passed straight to it, never through a shell,
 *   - in a folder that resolves (symlinks followed) inside one of the
 *     workspaces the app registered (./workspaces.ts), never elsewhere.
 *
 * A process outlives the request that started it (it runs in the runner's own
 * scope). Its output is kept (the last lines in memory, every line in a log
 * file) so a viewer that arrives late still sees the whole run.
 *
 * @internal
 */
import { Clock, Context, Deferred, Effect, Fiber, FileSystem, Layer, Option, Path, PubSub, Ref, Schema, Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { resolveWithin } from "../fs";
import { Workspaces } from "../workspaces";

/** Programs that may be started. An allowlist: a denylist here would be a
 * remote shell with extra steps. */
const allowedCommands: ReadonlySet<string> = new Set(["pnpm", "npm", "yarn", "bun", "npx", "node", "git", "eas"]);

/** Lines kept in memory per process; the log file keeps everything. */
const backlogLines = 2000;

/** Where transcripts are written, under the server's working folder. */
const logFolder = [".agent-console", "logs"];

/** The request was refused (not allowed, or no such process). */
export class ProcessRequestError extends Schema.TaggedErrorClass<ProcessRequestError>()("ProcessRequestError", {
  reason: Schema.Literals(["CommandNotAllowed", "OutsideWorkspaces", "UnknownProcess"]),
  message: Schema.String,
}) {}

/** The process could not be started. */
export class ProcessStartError extends Schema.TaggedErrorClass<ProcessStartError>()("ProcessStartError", {
  message: Schema.String,
}) {}

export const processSpec = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
});
export type ProcessSpec = typeof processSpec.Type;

/** One output line, numbered so a viewer joining mid-run gets each once. */
interface Line {
  readonly seq: number;
  readonly stream: "stdout" | "stderr";
  readonly text: string;
}

type Event = { readonly _tag: "Line"; readonly line: Line } | { readonly _tag: "Exit"; readonly exitCode: number | undefined };

interface Managed {
  readonly id: string;
  readonly backlog: Ref.Ref<ReadonlyArray<Line>>;
  readonly events: PubSub.PubSub<Event>;
  readonly exited: Deferred.Deferred<number | undefined>;
  readonly fiber: Fiber.Fiber<void, unknown>;
}

const lineEvent = Schema.fromJsonString(
  Schema.Struct({
    stream: Schema.Literals(["stdout", "stderr"]),
    text: Schema.String,
  }),
);
const exitEvent = Schema.fromJsonString(
  Schema.Struct({
    exitCode: Schema.optionalKey(Schema.Number),
  }),
);

/** A server-sent event, the wire format the app's output screen reads. */
const sse = (event: string, data: string): string => `event: ${event}\ndata: ${data}\n\n`;

const encodeEvent = (event: Event): string =>
  event._tag === "Line"
    ? sse("line", Schema.encodeSync(lineEvent)({ stream: event.line.stream, text: event.line.text }))
    : sse("exit", Schema.encodeSync(exitEvent)(event.exitCode === undefined ? {} : { exitCode: event.exitCode }));

const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaces = yield* Workspaces;
  const scope = yield* Effect.scope;
  const processes = yield* Ref.make<ReadonlyMap<string, Managed>>(new Map());
  const logDir = path.resolve(...logFolder);
  yield* fs.makeDirectory(logDir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined));

  const refused = (reason: ProcessRequestError["reason"], message: string) =>
    new ProcessRequestError({
      reason,
      message,
    });

  /** The spec's folder, if it is inside a registered workspace. */
  const workspaceFolder = (cwd: string) =>
    resolveWithin(cwd).pipe(
      Effect.mapError((cause) => refused("OutsideWorkspaces", `${cause.path}: ${cause.reason}`)),
      Effect.flatMap((real) =>
        workspaces.contains(real).pipe(
          Effect.flatMap((inside) => (inside ? Effect.succeed(real) : Effect.fail(refused("OutsideWorkspaces", `${cwd} is not inside a registered workspace`)))),
        ),
      ),
    );

  const start = (spec: ProcessSpec) =>
    Effect.gen(function* () {
      if (!allowedCommands.has(spec.command)) {
        return yield* refused("CommandNotAllowed", `${spec.command} is not allowed; allowed: ${[...allowedCommands].join(", ")}`);
      }
      const cwd = yield* workspaceFolder(spec.cwd);
      const startedAt = yield* Clock.currentTimeMillis;
      const existing = yield* Ref.get(processes);
      const id = `proc_${startedAt.toString(36)}_${existing.size.toString(36)}`;
      const logPath = path.join(logDir, `${id}.log`);
      const backlog = yield* Ref.make<ReadonlyArray<Line>>([]);
      const counter = yield* Ref.make(0);
      const events = yield* PubSub.unbounded<Event>();
      const exited = yield* Deferred.make<number | undefined>();
      const log = (text: string) => fs.writeFileString(logPath, text, { flag: "a" }).pipe(Effect.orElseSucceed(() => undefined));
      yield* log(`$ ${spec.command} ${spec.args.join(" ")}\n(cwd ${cwd})\n\n`);

      const record = (stream: Line["stream"]) => (text: string) =>
        Effect.gen(function* () {
          const seq = yield* Ref.updateAndGet(counter, (n) => n + 1);
          const line: Line = {
            seq,
            stream,
            text,
          };
          yield* Ref.update(backlog, (lines) => [...lines, line].slice(-backlogLines));
          yield* PubSub.publish(events, { _tag: "Line", line });
          yield* log(`${text}\n`);
        });

      const finish = (exitCode: number | undefined) =>
        Effect.gen(function* () {
          yield* log(`\n(exit ${exitCode === undefined ? "unknown" : String(exitCode)})\n`);
          yield* PubSub.publish(events, { _tag: "Exit", exitCode });
          yield* Deferred.succeed(exited, exitCode);
        });

      // No shell: argv goes straight to the program, so nothing in `args` can
      // be read as a pipe, a redirect or a second command.
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(spec.command, [...spec.args], {
            cwd,
            extendEnv: true,
          }),
        )
        .pipe(
          Scope.provide(scope),
          Effect.mapError((cause) => new ProcessStartError({ message: `${spec.command}: ${cause.message}` })),
        );

      const lines = (source: Stream.Stream<Uint8Array, unknown>) => source.pipe(Stream.decodeText, Stream.splitLines, Stream.filter((text) => text !== ""));
      const run = Stream.merge(lines(handle.stdout).pipe(Stream.mapEffect(record("stdout"))), lines(handle.stderr).pipe(Stream.mapEffect(record("stderr")))).pipe(
        Stream.runDrain,
        Effect.andThen(handle.exitCode),
        Effect.matchEffect({
          onSuccess: (code) => finish(code),
          onFailure: () => finish(undefined),
        }),
        // Stopped: kill the process and say how it ended.
        Effect.onInterrupt(() => handle.kill().pipe(Effect.orElseSucceed(() => undefined), Effect.andThen(finish(undefined)))),
      );
      const fiber = yield* Effect.forkIn(run, scope);
      yield* Ref.update(processes, (all) => new Map([...all, [id, { id, backlog, events, exited, fiber }]]));
      return { id };
    });

  const managed = (id: string) =>
    Ref.get(processes).pipe(
      Effect.flatMap((all) =>
        Option.match(Option.fromUndefinedOr(all.get(id)), {
          onNone: () => Effect.fail(refused("UnknownProcess", `no process ${id}`)),
          onSome: Effect.succeed,
        }),
      ),
    );

  /** A process's output as server-sent events: everything so far, then live
   * lines until it exits. Subscribing before reading the backlog, with line
   * numbers to drop the overlap, means no line is missed or sent twice. */
  const follow = (id: string) =>
    managed(id).pipe(
      Effect.map((process) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(process.events);
            const past = yield* Ref.get(process.backlog);
            const done = yield* Deferred.poll(process.exited);
            const lastSeq = past.at(-1)?.seq ?? 0;
            const history = Stream.fromIterable(past.map((line): Event => ({ _tag: "Line", line })));
            if (Option.isSome(done)) {
              const exitCode = yield* done.value;
              const ended: Event = {
                _tag: "Exit",
                exitCode,
              };
              return history.pipe(Stream.concat(Stream.succeed(ended)));
            }
            const live = Stream.fromSubscription(subscription).pipe(
              Stream.filter((event) => event._tag === "Exit" || event.line.seq > lastSeq),
              Stream.takeUntil((event) => event._tag === "Exit"),
            );
            return history.pipe(Stream.concat(live));
          }),
        ).pipe(
          Stream.map(encodeEvent),
          // A comment line every 15 s keeps an idle stream from being dropped.
          Stream.merge(Stream.tick("15 seconds").pipe(Stream.drop(1), Stream.map(() => ": ping\n\n")), { haltStrategy: "left" }),
          Stream.encodeText,
        ),
      ),
    );

  const stop = (id: string) => managed(id).pipe(Effect.flatMap((process) => Fiber.interrupt(process.fiber)));

  return {
    start,
    follow,
    stop,
  };
});

export class ProcessRunner extends Context.Service<ProcessRunner, Effect.Success<typeof make>>()("agent-console/ProcessRunner") {
  static readonly layer = Layer.effect(ProcessRunner, make);
}
