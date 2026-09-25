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
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { api } from "./api";
import { ExtensionViews } from "./extensionHost/extensionViews";
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
        .handle("invoke", ({ payload }) => views.invoke(payload.workspace, payload.view, payload.node, payload.command)),
    ),
  ),
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

const apiLive = HttpApiBuilder.layer(api).pipe(
  Layer.provide([extensionsHandlers, configHandlers, fontsHandlers, viewsHandlers.pipe(Layer.provide(ExtensionViews.layer))]),
);

const port = Number(process.env.AGENT_CONSOLE_API_PORT ?? 5199);

const serverLive = HttpRouter.serve(Layer.mergeAll(apiLive, fontFileRoute)).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })));

NodeRuntime.runMain(Layer.launch(serverLive));
