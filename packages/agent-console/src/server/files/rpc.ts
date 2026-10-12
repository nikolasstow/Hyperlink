/**
 * The file hub served as file-sync's RPC group over a WebSocket at
 * `FileSync.path`, for the API server's router.
 *
 * @internal
 */
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { FileSync } from "file-sync";
import { FileHub } from "./hub";

const handlers = FileSync.FileSyncRpcs.toLayer(
  FileHub.pipe(
    Effect.map((hub) => ({
      Follow: ({ path }: { readonly path: string }) => hub.follow(path),
      Write: (request: FileSync.WriteRequest) => hub.write(request),
    })),
  ),
);

/** The route, with its own hub (reaching opencode through `fetch`). */
export const fileSyncLayer = RpcServer.layerHttp({
  group: FileSync.FileSyncRpcs,
  path: FileSync.path,
  protocol: "websocket",
}).pipe(
  Layer.provide([
    handlers.pipe(Layer.provide(FileHub.layer.pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer])))),
    RpcSerialization.layerJson,
  ]),
);
