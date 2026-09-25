/**
 * Extension views, served: the API server's side of the extension host.
 *
 * One host worker for every workspace (a repo or worktree folder), started
 * with the server so it is warm before anyone asks: VS Code's one extension
 * host per window, the window being every folder the app shows. The worker
 * runs the extensions; this side routes calls to it, confines workspaces to
 * the files root, and puts a deadline on every call, because a worker that has
 * died leaves its caller waiting forever otherwise.
 *
 * Which extensions a host runs: for now VS Code's built-in `npm` extension,
 * taken from an installed VS Code-family app, since built-ins ship inside the
 * app rather than in an extensions folder.
 *
 * @internal
 */
import { NodeServices, NodeWorker } from "@effect/platform-node";
import { Worker } from "node:worker_threads";
import { Context, Duration, Effect, FileSystem, Layer, Option, Path } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { resolveWithin } from "../fs";
import { ExtensionHostError, ExtensionHostRpcs, ViewRequestError, type TreeRefresh } from "./protocol";

/** How long one host call may take, activation included on a cold start. */
const callDeadline = Duration.seconds(30);

/** Where VS Code-family apps keep their built-in extensions. */
const builtinRoots: ReadonlyArray<string> = [
  "/Applications/Cursor.app/Contents/Resources/app/extensions",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions",
];

/** The built-in extensions every host runs. */
const builtins: ReadonlyArray<string> = ["npm"];

const hostError = (reason: ExtensionHostError["reason"], message: string) =>
  new ExtensionHostError({
    reason,
    message,
  });

/** Each built-in's folder, from the first installed app that ships it. */
const locateBuiltins = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* Effect.forEach(builtins, (name) =>
    Effect.findFirst(builtinRoots, (root) => fs.exists(path.join(root, name, "package.json")).pipe(Effect.orElseSucceed(() => false))).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(hostError("HostUnavailable", `built-in extension "${name}" not found in any of: ${builtinRoots.join(", ")}`)),
          onSome: (root) => Effect.succeed(path.join(root, name)),
        }),
      ),
    ),
  );
});

const make = Effect.gen(function* () {
  const extensions = yield* locateBuiltins;
  const bootstrap = new URL("./bootstrap.mjs", import.meta.url);

  // The host starts now, with the service, and lives as long as it: its layer
  // is built into the service's own scope.
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolWorker({ size: 1 }).pipe(
      Layer.provide(
        NodeWorker.layer(
          () =>
            new Worker(bootstrap, {
              workerData: {
                extensions,
              },
            }),
        ),
      ),
    ),
  );
  const client = yield* RpcClient.make(ExtensionHostRpcs).pipe(Effect.provideContext(protocol));

  const workspaceOf = (requested: string) =>
    resolveWithin(requested).pipe(
      Effect.mapError(
        (cause) =>
          new ViewRequestError({
            reason: "BadWorkspace",
            message: `${cause.path}: ${cause.reason}`,
          }),
      ),
    );

  /** One call to the host, under the deadline. A transport failure (the
   * worker died, a message did not decode) and a missed deadline both come
   * back as a host error the client can show. */
  const withDeadline = <A, E>(what: string, call: Effect.Effect<A, E>) =>
    call.pipe(
      Effect.timeoutOrElse({
        duration: callDeadline,
        orElse: () => Effect.fail(hostError("Timeout", `the extension host did not answer ${what} within ${Duration.format(callDeadline)}`)),
      }),
      Effect.mapError((cause) =>
        cause instanceof ExtensionHostError || cause instanceof ViewRequestError
          ? cause
          : hostError("HostUnavailable", cause instanceof RpcClientError ? cause.message : String(cause)),
      ),
    );

  return {
    views: (workspace: string) =>
      workspaceOf(workspace).pipe(Effect.flatMap((resolved) => withDeadline("views", client.Views({ workspace: resolved })))),
    children: (workspace: string, view: string, parent: string | undefined) =>
      workspaceOf(workspace).pipe(
        Effect.flatMap((resolved) =>
          withDeadline(
            "children",
            client.Children({
              workspace: resolved,
              view,
              ...(parent === undefined ? {} : { parent }),
            }),
          ),
        ),
      ),
    tree: (workspace: string, view: string, refresh: TreeRefresh) =>
      workspaceOf(workspace).pipe(
        Effect.flatMap((resolved) =>
          withDeadline(
            "tree",
            client.Tree({
              workspace: resolved,
              view,
              refresh,
            }),
          ),
        ),
      ),
    invoke: (workspace: string, view: string, node: string, command: string) =>
      workspaceOf(workspace).pipe(
        Effect.flatMap((resolved) =>
          withDeadline(
            command,
            client.Invoke({
              workspace: resolved,
              view,
              node,
              command,
            }),
          ),
        ),
      ),
    /** Register workspaces and walk their views now, so the first look at any
     * of them is served from warm caches. */
    warm: (workspaces: ReadonlyArray<string>) =>
      Effect.forEach(workspaces, workspaceOf).pipe(
        Effect.flatMap((resolved) => withDeadline("warm", client.Warm({ workspaces: resolved }))),
      ),
  };
});

export class ExtensionViews extends Context.Service<ExtensionViews, Effect.Success<typeof make>>()("agent-console/ExtensionViews") {
  static readonly layer = Layer.effect(ExtensionViews, make).pipe(Layer.provide(NodeServices.layer));
}
