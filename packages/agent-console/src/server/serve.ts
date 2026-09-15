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
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { api } from "./api";
import { getConfig, installFromMarketplace, listExtensions, putConfig, removeExtension } from "./extensions";

const extensionsHandlers = HttpApiBuilder.group(api, "extensions", (handlers) =>
  handlers
    .handle("list", () => listExtensions())
    .handle("install", ({ payload }) => installFromMarketplace(payload.ref))
    .handle("remove", ({ payload }) => removeExtension(payload.id).pipe(Effect.as({ ok: true }))),
);

const configHandlers = HttpApiBuilder.group(api, "config", (handlers) =>
  handlers
    .handle("configGet", () => getConfig())
    .handle("configPut", ({ payload }) => putConfig(payload)),
);

const apiLive = HttpApiBuilder.layer(api).pipe(Layer.provide([extensionsHandlers, configHandlers]));

const port = Number(process.env.AGENT_CONSOLE_API_PORT ?? 5199);

const serverLive = HttpRouter.serve(apiLive).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })));

NodeRuntime.runMain(Layer.launch(serverLive));
