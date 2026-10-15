/**
 * Language intelligence from the API server's language servers
 * (agent-console-protocol `Language`; docs/handoffs/code-intelligence.md):
 * each followed file's problems, kept as they change, and the type at a place.
 *
 * It follows the files live files follow (open tabs, kept files, what is on
 * screen; useLiveFiles.ts), so a file's problems are there before it is
 * opened. A file no server knows (its language) is left alone; any other
 * failure is tried again, backing off.
 *
 * @internal
 */
import { Language } from "agent-console-protocol";
import { Context, Duration, Effect, FiberMap, HashMap, Layer, RcMap, Ref, Schedule, Stream, SubscriptionRef } from "effect";
import { HttpClient } from "effect/http";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import { ticketedSocketUrl } from "../auth/socketUrl";

/** How long a server's connection stays after nothing uses it. */
const KEEP_CONNECTION = Duration.seconds(30);

const retry = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.seconds(30)))),
  Schedule.jittered,
);

const connect = (api: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const protocol = yield* Layer.build(
      RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
        Layer.provide(Socket.layerWebSocket(ticketedSocketUrl(http, api, Language.path))),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(RpcSerialization.layerJson),
      ),
    );
    return yield* RpcClient.make(Language.LanguageRpcs).pipe(Effect.provideContext(protocol));
  });

const make = Effect.gen(function* () {
  const connections = yield* RcMap.make({ lookup: connect, idleTimeToLive: KEEP_CONNECTION });
  const problems = yield* SubscriptionRef.make(HashMap.empty<string, Language.FileDiagnostics>());
  const follows = yield* FiberMap.make<string>();
  /** What is followed now, by key (server and path). */
  const followed = yield* Ref.make<ReadonlySet<string>>(new Set());

  /** Keeps one file's problems, until interrupted. */
  const followOne = (api: string, path: string) =>
    Effect.gen(function* () {
      const client = yield* RcMap.get(connections, api);
      yield* client.Diagnostics({ path }).pipe(Stream.runForEach((next) => SubscriptionRef.update(problems, HashMap.set(path, next))));
    }).pipe(
      Effect.scoped,
      Effect.retry({ while: (error) => !(error instanceof Language.LanguageError && error.reason === "Unsupported"), schedule: retry }),
      Effect.catch((error) =>
        error instanceof Language.LanguageError && error.reason === "Unsupported" ? Effect.void : Effect.logWarning(`[language] problems of ${path} stopped`, error),
      ),
    );

  return {
    /** Every followed file's problems, as they change. */
    changes: SubscriptionRef.changes(problems),
    /** Follows `paths` on `api`: new ones start, gone ones stop (and their
     * problems go). */
    follow: (api: string, paths: ReadonlySet<string>) =>
      Effect.gen(function* () {
        const wanted = new Set([...paths].map((path) => followKey(api, path)));
        for (const key of yield* Ref.get(followed)) {
          if (wanted.has(key)) continue;
          yield* FiberMap.remove(follows, key);
          yield* SubscriptionRef.update(problems, HashMap.remove(splitKey(key)[1]));
        }
        for (const path of paths) {
          yield* FiberMap.run(follows, followKey(api, path), followOne(api, path), { onlyIfMissing: true });
        }
        yield* Ref.set(followed, wanted);
      }),
    /** What is at `offset` in `path`, if anything. */
    hover: (api: string, path: string, offset: number) =>
      Effect.gen(function* () {
        const client = yield* RcMap.get(connections, api);
        return yield* client.Hover({ path, offset });
      }).pipe(Effect.scoped),
  };
});

const followKey = (api: string, path: string): string => `${api}\n${path}`;
const splitKey = (key: string): readonly [string, string] => {
  const at = key.indexOf("\n");
  return [key.slice(0, at), key.slice(at + 1)];
};

/** Needs an `HttpClient` (for WebSocket tickets). */
export class LanguageClient extends Context.Service<LanguageClient, Effect.Success<typeof make>>()("@doubleagent/language/LanguageClient") {
  static readonly layer = Layer.effect(LanguageClient, make);
}
