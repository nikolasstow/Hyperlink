/**
 * The file hub served as file-sync's RPC group over a WebSocket at
 * `FileSync.path`, for the API server's router.
 *
 * @internal
 */
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
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

/** The one hub the server's routes share (the live files, and the language
 * servers that follow them), reaching opencode through `fetch`. */
export const fileHubLayer = FileHub.layer.pipe(Layer.provide([NodeServices.layer, FetchHttpClient.layer]));

/** The route. Needs the hub. */
export const fileSyncLayer = RpcServer.layerHttp({
  group: FileSync.FileSyncRpcs,
  path: FileSync.path,
  protocol: "websocket",
}).pipe(Layer.provide([handlers, RpcSerialization.layerJson]));
