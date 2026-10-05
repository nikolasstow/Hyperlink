/**
 * The app's Effect runtime — the boundary between the Effect data layer and the
 * React screens. One runtime for the process, holding every service the data
 * layer needs; React reaches it through `runFs` / `runApp` (a Promise back) or
 * subscribes to its streams (outbox/useOutbox.ts).
 *
 * Services:
 * - `HttpClient` (the platform `fetch`, which index.ts makes expo's, so
 *   server-sent events stream);
 * - the device's signals (network, foreground);
 * - opencode v2 clients per server, their reachability;
 * - the outbox (its lanes persisted in AsyncStorage under their own prefix),
 *   and how it makes new folders;
 * - the conversations kept on the device (their own prefix);
 * - each session's own chat background (its own prefix);
 * - Home's last layout, for the launch screen (its own prefix);
 * - where Files is, per repo (its own prefix).
 *
 * No per-server state lives in the layers' construction (servers are passed
 * to each call), so the runtime never needs rebuilding on reconnect.
 *
 * @internal
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { Conversations } from "../conversations/Conversations";
import { FileNav } from "../files/FileNav";
import { HomeLayoutStore } from "../home/HomeLayoutStore";
import { SessionBackgrounds } from "../sessions/SessionBackgrounds";
import { Opencode } from "../opencode/Opencode";
import { layer as foldersLayer } from "../outbox/foldersNative";
import { Outbox } from "../outbox/Outbox";
import { Reachability } from "../outbox/Reachability";
import { layer as asyncStorageLayer } from "./asyncStorage";
import { layer as deviceSignalsLayer } from "./deviceSignalsNative";

const OUTBOX_STORAGE_PREFIX = "agent-console-native:outbox:";
const CONVERSATIONS_STORAGE_PREFIX = "agent-console-native:conversations:";
const SESSIONS_STORAGE_PREFIX = "agent-console-native:sessions:";
const HOME_STORAGE_PREFIX = "agent-console-native:home:";
const FILES_STORAGE_PREFIX = "agent-console-native:files:";

const platform = Layer.mergeAll(FetchHttpClient.layer, deviceSignalsLayer, foldersLayer);

const AppLayer = Layer.mergeAll(
  Outbox.layer,
  Conversations.layer.pipe(Layer.provide(asyncStorageLayer(CONVERSATIONS_STORAGE_PREFIX))),
  SessionBackgrounds.layer.pipe(Layer.provide(asyncStorageLayer(SESSIONS_STORAGE_PREFIX))),
  HomeLayoutStore.layer.pipe(Layer.provide(asyncStorageLayer(HOME_STORAGE_PREFIX))),
  FileNav.layer.pipe(Layer.provide(asyncStorageLayer(FILES_STORAGE_PREFIX))),
).pipe(
  Layer.provideMerge(Reachability.layer),
  Layer.provideMerge(Opencode.layer),
  Layer.provide(asyncStorageLayer(OUTBOX_STORAGE_PREFIX)),
  Layer.provideMerge(platform),
);

export type AppServices = Layer.Success<typeof AppLayer>;

const runtime = ManagedRuntime.make(AppLayer);

/**
 * Run a data-layer Effect and get its result as a Promise for React. A typed
 * failure rejects the promise with that error value (so a caller can still
 * read its `_tag`); callers that treat failures as "absent" should catch.
 */
export const runFs = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> => runtime.runPromise(effect);

/** Run an Effect that needs any of the app's services; a Promise back. */
export const runApp = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> => runtime.runPromise(effect);

/** Start an Effect that needs the app's services and keeps running (a
 * subscription); interrupting the returned fiber stops it. */
export const forkApp = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runFork(effect);
