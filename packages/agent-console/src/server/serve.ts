/**
 * The standalone Effect HTTP API server — the off-vite backend entry.
 *
 * Wires the `HttpApi` (api.ts) to its handlers (the server-agnostic cores) and
 * serves it with `@effect/platform-node`'s `NodeHttpServer`, which also supplies
 * the platform services the handlers need (FileSystem, Path, HttpPlatform,
 * Etag). No vite. Run with `pnpm serve` (port via `AGENT_CONSOLE_API_PORT`,
 * default 5199).
 *
 * This is the first brick: `extensions` + `config` live here now; the remaining
 * dev-server plugins (fs, processes, …) migrate into groups here over time,
 * after which vite is only the web bundle.
 *
 * @internal
 */
import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { api } from "./api";
import { DeviceAuth } from "./auth/DeviceAuth";
import { authHandlers, authMiddleware, healthRoute } from "./auth/http";
import { CollectionStates } from "./collections/state";
import { ExtensionViews } from "./extensionHost/extensionViews";
import { fileSyncLayer } from "./files/rpc";
import { modelsRoute } from "./models/catalog";
import { opencodeProxyRoute } from "./opencodeProxy";
import { PluginRegistry } from "./plugin/registry";
import { ProcessRunner } from "./processes/runner";
import { ProjectsStore } from "./projects/store";
import { reposListOf, sessionsList } from "./projects/context";
import { tasksOf } from "./projects/tasks";
import { renderPage } from "./projects/render";
import { SessionArchive } from "./sessions/archive";
import { Workspaces } from "./workspaces";
import { importFont, inspectFont, readFontFile } from "./fonts";
import {
  discoverLocalExtensions,
  getConfig,
  importFromPath,
  installFromMarketplace,
  listExtensions,
  putConfig,
  readThemeFile,
  removeExtension,
} from "./extensions";

const extensionsHandlers = HttpApiBuilder.group(api, "extensions", (handlers) =>
  handlers
    .handle("list", () => listExtensions())
    .handle("install", ({ payload }) => installFromMarketplace(payload.ref))
    .handle("remove", ({ payload }) => removeExtension(payload.id).pipe(Effect.as({ ok: true })))
    .handle("discover", () => discoverLocalExtensions())
    .handle("import", ({ payload }) => importFromPath(payload.path))
    .handle("theme", ({ payload }) => readThemeFile(payload.file)),
);

const configHandlers = HttpApiBuilder.group(api, "config", (handlers) =>
  handlers
    .handle("configGet", () => getConfig())
    .handle("configPut", ({ payload }) => putConfig(payload)),
);

const fontsHandlers = HttpApiBuilder.group(api, "fonts", (handlers) =>
  handlers
    .handle("inspect", ({ payload }) => inspectFont(payload.url))
    .handle("import", ({ payload }) => importFont(payload.url)),
);

// The service is resolved once, when the group is built, so the handlers close
// over it rather than asking for it on every request.
const viewsHandlers = HttpApiBuilder.group(api, "views", (handlers) =>
  ExtensionViews.pipe(
    Effect.map((views) =>
      handlers
        .handle("list", ({ payload }) => views.views(payload.workspace))
        .handle("children", ({ payload }) => views.children(payload.workspace, payload.view, payload.parent))
        .handle("tree", ({ payload }) => views.tree(payload.workspace, payload.view, payload.refresh))
        .handle("invoke", ({ payload }) => views.invoke(payload.workspace, payload.view, payload.node, payload.command))
        .handle("warm", ({ payload }) => views.warm(payload.workspaces)),
    ),
  ),
);

const pagesHandlers = HttpApiBuilder.group(api, "pages", (handlers) =>
  Effect.all([ExtensionViews, CollectionStates]).pipe(
    Effect.map(([views, states]) =>
      handlers
        .handle("sections", ({ payload }) => views.sections(payload.workspace, payload.page, payload.params, payload.refresh))
        .handle("sectionsInvoke", ({ payload }) => views.sectionsInvoke(payload))
        .handle("collectionSearch", ({ payload }) => views.collectionSearch(payload))
        .handle("collection", ({ payload }) => views.collection(payload.workspace, payload.page, payload.refresh))
        .handle("collectionInvoke", ({ payload }) => views.collectionInvoke(payload))
        .handle("collectionState", ({ payload }) => states.get(payload.workspace, payload.page))
        .handle("collectionChange", ({ payload }) => states.apply(payload.workspace, payload.page, payload.change)),
    ),
  ),
);

const processesHandlers = HttpApiBuilder.group(api, "processes", (handlers) =>
  ProcessRunner.pipe(
    Effect.map((runner) =>
      handlers
        .handle("start", ({ payload }) => runner.start(payload))
        .handle("stop", ({ payload }) => runner.stop(payload.id).pipe(Effect.as({ ok: true }))),
    ),
  ),
);

const projectsHandlers = HttpApiBuilder.group(api, "projects", (handlers) =>
  Effect.all([ProjectsStore, Workspaces]).pipe(
    Effect.map(([store, workspaces]) =>
      handlers
        .handle("projectsList", () => store.listProjects)
        .handle("projectGet", ({ params }) => store.getProject(params.slug))
        .handle("projectPut", ({ params, payload }) => store.putProject(params.slug, payload))
        .handle("projectDelete", ({ params }) => store.deleteProject(params.slug).pipe(Effect.as({ ok: true })))
        .handle("pagesList", ({ params }) => store.listPages(params.slug))
        .handle("pageGet", ({ params }) => store.getPage(params.slug, params.page))
        .handle("pagePut", ({ params, payload }) => store.putPage(params.slug, params.page, payload))
        .handle("pageDelete", ({ params }) => store.deletePage(params.slug, params.page).pipe(Effect.as({ ok: true })))
        .handle("tasksList", ({ params }) => store.getProject(params.slug).pipe(Effect.flatMap(tasksOf)))
        .handle("reposList", () => reposListOf(workspaces))
        .handle("sessionsList", () => sessionsList),
    ),
  ),
);

const pluginsHandlers = HttpApiBuilder.group(api, "plugins", (handlers) =>
  PluginRegistry.pipe(Effect.map((registry) => handlers.handle("list", () => registry.list))),
);

const sessionsHandlers = HttpApiBuilder.group(api, "sessions", (handlers) =>
  SessionArchive.pipe(
    Effect.map((archive) =>
      handlers
        .handle("archived", () => archive.list)
        .handle("archive", ({ payload }) => archive.archive(payload.id))
        .handle("unarchive", ({ payload }) => archive.unarchive(payload.id))
        .handle("muted", () => archive.muted)
        .handle("mute", ({ payload }) => archive.mute(payload.id))
        .handle("unmute", ({ payload }) => archive.unmute(payload.id)),
    ),
  ),
);

// A process's output as server-sent events: `?id=<process id>`. Raw, since
// it streams. 404 for an unknown process.
const processStreamRoute = HttpRouter.add("GET", "/processes/stream", (request) =>
  Effect.gen(function* () {
    const id = new URL(request.url, "http://localhost").searchParams.get("id");
    if (id === null) return HttpServerResponse.empty({ status: 400 });
    const runner = yield* ProcessRunner;
    return yield* runner.follow(id).pipe(
      Effect.map((body) =>
        HttpServerResponse.stream(body, {
          contentType: "text/event-stream",
          headers: {
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        }),
      ),
      Effect.catchTag("ProcessRequestError", () => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
    );
  }),
);

// A page as a full HTML document with the SDK injected: `?project=<slug>&
// slug=<page>&env=app|browser`. The browser opens this directly; the app's
// WebView loads it and adds the auth token. Raw HTML, so it is a router route,
// not an HttpApi endpoint. Served behind the same gate as everything else.
const projectsViewRoute = HttpRouter.add("GET", "/projects/view", (request) =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost");
    const project = url.searchParams.get("project");
    const slug = url.searchParams.get("slug");
    if (project === null || slug === null) return HttpServerResponse.text("Expected ?project=<slug>&slug=<page>", { status: 400 });
    const env = url.searchParams.get("env") === "app" ? "app" : "browser";
    const store = yield* ProjectsStore;
    return yield* store.getPage(project, slug).pipe(
      Effect.map((page) =>
        HttpServerResponse.text(renderPage(page, { env }), {
          contentType: "text/html; charset=utf-8",
          headers: { "cache-control": "no-store" },
        }),
      ),
      Effect.catchTag("ProjectsInvalidSlug", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 400 }))),
      Effect.catchTag("ProjectsNotFound", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 404 }))),
      Effect.catchTag("ProjectsError", (error) => Effect.succeed(HttpServerResponse.text(error.message, { status: 500 }))),
    );
  }),
);

// A raw route to serve stored (converted) font bytes — binary, so it's an
// HttpRouter route rather than an HttpApi endpoint. `?id=<fileId>`.
const fontFileRoute = HttpRouter.add("GET", "/fonts/file", (request) =>
  Effect.gen(function* () {
    const id = new URL(request.url, "http://localhost").searchParams.get("id");
    if (id === null) return HttpServerResponse.empty({ status: 400 });
    return yield* readFontFile(id).pipe(
      Effect.map((bytes) => HttpServerResponse.uint8Array(bytes, { contentType: "font/ttf" })),
      Effect.catchTag("FontError", () => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
    );
  }),
);

// One Workspaces for both: the views register the app's workspaces, the
// runner checks against them.
const workspacesLive = Workspaces.layer;
// One PluginRegistry for the host (what it loads) and the manager (what it
// shows).
const registryLive = PluginRegistry.layer.pipe(Layer.provide(NodeServices.layer));
const viewsLive = ExtensionViews.layer.pipe(Layer.provide([workspacesLive, registryLive]));
const statesLive = CollectionStates.layer.pipe(Layer.provide(registryLive));
const runnerLive = ProcessRunner.layer.pipe(Layer.provide([workspacesLive, NodeServices.layer]));
// One DeviceAuth for the gate (every request) and the auth endpoints.
const authLive = DeviceAuth.layer;
// The projects/pages store (a file tree), shared by the API and the render
// route.
const projectsLive = ProjectsStore.layer;

const apiLive = HttpApiBuilder.layer(api).pipe(
  Layer.provide([
    extensionsHandlers,
    configHandlers,
    fontsHandlers,
    viewsHandlers.pipe(Layer.provide(viewsLive)),
    pagesHandlers.pipe(Layer.provide([viewsLive, statesLive])),
    processesHandlers.pipe(Layer.provide(runnerLive)),
    projectsHandlers.pipe(Layer.provide([projectsLive, workspacesLive])),
    pluginsHandlers.pipe(Layer.provide(registryLive)),
    sessionsHandlers.pipe(Layer.provide(SessionArchive.layer)),
    authHandlers.pipe(Layer.provide(authLive)),
  ]),
);

const port = Number(process.env.AGENT_CONSOLE_API_PORT ?? 5199);

// The stream route needs the runner per request, so it is provided to the
// served router as a whole (the same instance the API's handlers use).
// Every route is behind the gate (auth/http.ts); `/health` and redeeming a
// pairing code are open.
const serverLive = HttpRouter.serve(
  Layer.mergeAll(
    apiLive,
    fontFileRoute,
    processStreamRoute,
    projectsViewRoute,
    fileSyncLayer,
    opencodeProxyRoute,
    modelsRoute,
    healthRoute,
    authMiddleware.pipe(Layer.provide(authLive)),
  ),
).pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(runnerLive),
  Layer.provide(projectsLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
);

NodeRuntime.runMain(Layer.launch(serverLive));
