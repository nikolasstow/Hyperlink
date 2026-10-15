/**
 * The language host served as agent-console-protocol's `Language` RPC group
 * over a WebSocket at `Language.path`, for the API server's router.
 *
 * @internal
 */
import { Language } from "agent-console-protocol";
import { Effect, Layer } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { LanguageHost } from "./host";

const handlers = Language.LanguageRpcs.toLayer(
  LanguageHost.pipe(
    Effect.map((host) => ({
      Diagnostics: ({ path }: { readonly path: string }) => host.diagnostics(path),
      Hover: ({ path, offset }: { readonly path: string; readonly offset: number }) => host.hover(path, offset),
    })),
  ),
);

/** The route. Needs the language host. */
export const languageLayer = RpcServer.layerHttp({
  group: Language.LanguageRpcs,
  path: Language.path,
  protocol: "websocket",
}).pipe(Layer.provide([handlers, RpcSerialization.layerJson]));
