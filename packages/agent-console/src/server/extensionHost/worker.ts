/**
 * The host worker's entry point: one worker thread running the extension host
 * (for every workspace) behind the RPC protocol.
 *
 * Extensions run here rather than in the API server for the reason VS Code
 * runs them in a separate extension host: they are other people's code. A
 * worker thread has its own module cache and globals, so the `vscode` module
 * hook and anything an extension leaves behind stay in here, and one that
 * wedges can be torn down without the server.
 *
 * Spawned through `bootstrap.mjs`, which registers tsx first (a worker does not
 * inherit it from the parent's flags).
 *
 * @internal
 */
import { NodeRuntime, NodeServices, NodeWorkerRunner } from "@effect/platform-node";
import { workerData } from "node:worker_threads";
import { Effect, Layer, Schema } from "effect";
import { RpcServer } from "effect/unstable/rpc";
import { makeHost } from "./host";
import { ExtensionHostRpcs } from "./protocol";

/** What the parent passes at spawn: the extension folders to run. */
export const hostWorkerData = Schema.Struct({
  extensions: Schema.Array(Schema.String),
});

const handlers = ExtensionHostRpcs.toLayer(
  Schema.decodeUnknownEffect(hostWorkerData)(workerData).pipe(
    Effect.orDie,
    Effect.flatMap(makeHost),
  ),
);

RpcServer.layer(ExtensionHostRpcs).pipe(
  Layer.provide(handlers),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
  Layer.provide(NodeServices.layer),
  Layer.launch,
  NodeRuntime.runMain,
);
