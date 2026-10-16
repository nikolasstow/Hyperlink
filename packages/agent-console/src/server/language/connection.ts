/**
 * One language server process, spoken to over the language server protocol
 * (JSON-RPC on its stdin/stdout, framing.ts): requests with their answers,
 * notifications both ways, and the few requests a server sends the client
 * answered with the defaults. Lives as long as its scope; closing it stops the
 * process.
 *
 * @internal
 */
import { Deferred, Duration, Effect, Option, PubSub, Queue, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { frame, messages } from "./framing";

/** A request takes at most this long. */
const REQUEST_TIMEOUT = Duration.seconds(30);

/** The language server failed a request, did not answer, or stopped. */
export class LspError extends Schema.TaggedError<LspError>()("LspError", {
  method: Schema.String,
  message: Schema.String,
}) {}

/** Anything the server sends: an answer (`id`, no `method`), a request to us
 * (`id` and `method`), or a notification (`method`, no `id`). */
const Incoming = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.Number, Schema.String])),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Unknown),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
});
const decodeIncoming = Schema.decodeUnknownOption(Schema.fromJsonString(Incoming));

export interface Notification {
  readonly method: string;
  readonly params: unknown;
}

/** What we answer a request the server sends us: `settings` for each it asks
 * for (unset when none); anything else (progress tokens, capability
 * registration, a refresh) is fine. */
const answerTo = (method: string, params: unknown, settings: unknown): unknown => {
  if (method === "workspace/configuration" && typeof params === "object" && params !== null && "items" in params && Array.isArray(params.items)) {
    return params.items.map(() => settings);
  }
  return null;
};

/** Starts `script` (a Node CLI) with `--stdio` in `cwd`, and speaks to it.
 * Requests the server sends come with its notifications too (a refresh is
 * acted on after it is answered). */
export const connect = (script: string, cwd: string, settings: unknown = null) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, [script, "--stdio"], { cwd }));

    const outgoing = yield* Queue.unbounded<Uint8Array>();
    yield* Stream.fromQueue(outgoing).pipe(Stream.run(handle.stdin), Effect.forkScoped);
    const send = (message: Record<string, unknown>) => Queue.offer(outgoing, frame({ jsonrpc: "2.0", ...message }));

    const notifications = yield* PubSub.unbounded<Notification>();
    const pending = new Map<number, Deferred.Deferred<unknown, LspError>>();
    let nextID = 0;

    const receive = (text: string) =>
      Option.match(decodeIncoming(text), {
        onNone: () => Effect.logWarning(`[language] an unreadable message from the server: ${text.slice(0, 200)}`),
        onSome: (message) => {
          const { id, method } = message;
          if (method === undefined) {
            const waiting = typeof id === "number" ? pending.get(id) : undefined;
            if (waiting === undefined) return Effect.void;
            pending.delete(Number(id));
            return message.error === undefined
              ? Deferred.succeed(waiting, message.result)
              : Deferred.fail(waiting, new LspError({ method: "response", message: message.error.message }));
          }
          const told = PubSub.publish(notifications, { method, params: message.params });
          return id === undefined ? told : send({ id, result: answerTo(method, message.params, settings) }).pipe(Effect.andThen(told));
        },
      });

    // What the server says, until it stops; then whatever waits on it fails.
    yield* messages(handle.stdout).pipe(
      Stream.runForEach(receive),
      Effect.catchCause((cause) => Effect.logError("[language] reading the server failed", cause)),
      Effect.ensuring(
        Effect.suspend(() =>
          Effect.forEach([...pending.values()], (waiting) => Deferred.fail(waiting, new LspError({ method: "response", message: "The language server stopped." })), { discard: true }),
        ),
      ),
      Effect.forkScoped,
    );
    // Its own log goes to ours (and the pipe never fills).
    yield* handle.stderr.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runForEach((line) => Effect.logDebug(`[language server] ${line}`)),
      Effect.ignore,
      Effect.forkScoped,
    );

    return {
      /** Asks the server; its answer, or why there is none. */
      request: (method: string, params: unknown): Effect.Effect<unknown, LspError> =>
        Effect.gen(function* () {
          const id = ++nextID;
          const answer = yield* Deferred.make<unknown, LspError>();
          pending.set(id, answer);
          yield* send({ id, method, params });
          return yield* Deferred.await(answer).pipe(
            Effect.timeoutOrElse({ duration: REQUEST_TIMEOUT, orElse: () => Effect.fail(new LspError({ method, message: "No answer in time." })) }),
            Effect.mapError((error: LspError) => new LspError({ method, message: error.message })),
            Effect.ensuring(Effect.sync(() => pending.delete(id))),
          );
        }),
      /** Tells the server. */
      notify: (method: string, params: unknown) => send({ method, params }),
      /** What the server tells us, as it comes. */
      notifications: Stream.fromPubSub(notifications),
    };
  });

export type Connection = Effect.Success<ReturnType<typeof connect>>;
