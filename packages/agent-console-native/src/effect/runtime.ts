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
 * - the extension code themes fetched, for the first frame after a launch
 *   (their own prefix);
 * - the custom code fonts installed on the device (their own prefix);
 * - where each file was left (its own prefix);
 * - where Files is, per repo (its own prefix);
 * - the pages open when the app was last used (its own prefix);
 * - Home's favorites (their own prefix);
 * - files kept in step with the file hub (live file sync).
 *
 * No per-server state lives in the layers' construction (servers are passed
 * to each call), so the runtime never needs rebuilding on reconnect.
 *
 * @internal
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { Conversations } from "../conversations/Conversations";
import { BarWindowStore } from "../dubz/BarWindowStore";
import { Favorites } from "../favorites/Favorites";
import { FileNav } from "../files/FileNav";
import { FileScrolls } from "../files/FileScrolls";
import { LiveFiles } from "../files/LiveFiles";
import { HomeLayoutStore } from "../home/HomeLayoutStore";
import { CodeFonts } from "../fonts/CodeFonts";
import { KeptThemes } from "../KeptThemes";
import { SessionBackgrounds } from "../sessions/SessionBackgrounds";
import { SessionWatch } from "../sessions/SessionWatch";
import { Opencode } from "../opencode/Opencode";
import { layer as foldersLayer } from "../outbox/foldersNative";
import { Outbox } from "../outbox/Outbox";
import { Reachability } from "../outbox/Reachability";
import { KeptNav } from "../navigation/KeptNav";
import { layer as asyncStorageLayer } from "./asyncStorage";
import { authedFetch } from "../auth/serverTokens";
import { authedStreamingFetch } from "../auth/streamingFetch";
import { CommandCatalog } from "../commands/CommandCatalog";
import { CommandEchoes } from "../commands/CommandEchoes";
import { LanguageClient } from "../language/LanguageClient";
import { LocalModelClient } from "../localModel/LocalModelClient";
import { InlineSuggestions } from "../language/complete";
import { ModelCatalog } from "../models/ModelCatalog";
import { ServerAuth } from "../auth/ServerAuth";
import { layer as secretStoreLayer } from "../auth/secretStoreNative";
import { layer as deviceSignalsLayer } from "./deviceSignalsNative";

const OUTBOX_STORAGE_PREFIX = "agent-console-native:outbox:";
const CONVERSATIONS_STORAGE_PREFIX = "agent-console-native:conversations:";
const SESSIONS_STORAGE_PREFIX = "agent-console-native:sessions:";
const HOME_STORAGE_PREFIX = "agent-console-native:home:";
const THEMES_STORAGE_PREFIX = "agent-console-native:themes:";
const FONTS_STORAGE_PREFIX = "agent-console-native:fonts:";
const SCROLLS_STORAGE_PREFIX = "agent-console-native:scrolls:";
const FILES_STORAGE_PREFIX = "agent-console-native:files:";
const NAV_STORAGE_PREFIX = "agent-console-native:nav:";
const FAVORITES_STORAGE_PREFIX = "agent-console-native:favorites:";
const BAR_WINDOW_STORAGE_PREFIX = "agent-console-native:barWindow:";

const AUTH_STORAGE_PREFIX = "agent-console-native:auth:";
const MODELS_STORAGE_PREFIX = "agent-console-native:models:";
const COMMANDS_STORAGE_PREFIX = "agent-console-native:commands:";
const ECHOES_STORAGE_PREFIX = "agent-console-native:echoes:";

// The model catalog, opencode's event stream and inline suggestions read
// their responses as they come, so their client streams (expo/fetch; React Native's own fetch reads a
// body whole).
const streamingHttpClient = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(authedStreamingFetch)));

// Every Effect HTTP request goes through `authedFetch`: a paired server's
// requests carry its token (auth/serverTokens.ts).
const httpClient = FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch)(authedFetch)));
const platform = Layer.mergeAll(httpClient, deviceSignalsLayer, foldersLayer);

const AppLayer = Layer.mergeAll(
  Outbox.layer,
  Conversations.layer.pipe(Layer.provide(asyncStorageLayer(CONVERSATIONS_STORAGE_PREFIX))),
  SessionBackgrounds.layer.pipe(Layer.provide(asyncStorageLayer(SESSIONS_STORAGE_PREFIX))),
  HomeLayoutStore.layer.pipe(Layer.provide(asyncStorageLayer(HOME_STORAGE_PREFIX))),
  KeptThemes.layer.pipe(Layer.provide(asyncStorageLayer(THEMES_STORAGE_PREFIX))),
  CodeFonts.layer.pipe(Layer.provide(asyncStorageLayer(FONTS_STORAGE_PREFIX))),
  FileScrolls.layer.pipe(Layer.provide(asyncStorageLayer(SCROLLS_STORAGE_PREFIX))),
  FileNav.layer.pipe(Layer.provide(asyncStorageLayer(FILES_STORAGE_PREFIX))),
  KeptNav.layer.pipe(Layer.provide(asyncStorageLayer(NAV_STORAGE_PREFIX))),
  Favorites.layer.pipe(Layer.provide(asyncStorageLayer(FAVORITES_STORAGE_PREFIX))),
  BarWindowStore.layer.pipe(Layer.provide(asyncStorageLayer(BAR_WINDOW_STORAGE_PREFIX))),
  LiveFiles.layer,
  LanguageClient.layer,
  LocalModelClient.layer,
  SessionWatch.layer,
  ServerAuth.layer.pipe(Layer.provide([asyncStorageLayer(AUTH_STORAGE_PREFIX), secretStoreLayer])),
  ModelCatalog.layer.pipe(Layer.provide([asyncStorageLayer(MODELS_STORAGE_PREFIX), streamingHttpClient])),
  InlineSuggestions.layer.pipe(Layer.provide(streamingHttpClient)),
  CommandCatalog.layer.pipe(Layer.provide(asyncStorageLayer(COMMANDS_STORAGE_PREFIX))),
).pipe(
  Layer.provideMerge(Reachability.layer),
  Layer.provideMerge(CommandEchoes.layer.pipe(Layer.provide(asyncStorageLayer(ECHOES_STORAGE_PREFIX)))),
  Layer.provideMerge(Opencode.layer.pipe(Layer.provide(streamingHttpClient))),
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
