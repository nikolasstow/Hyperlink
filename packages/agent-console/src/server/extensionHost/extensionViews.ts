/**
 * Extension views, served: the API server's side of the extension host.
 *
 * One host worker per workspace (a repo or worktree folder), started on first
 * use and kept while in use, then released after `idleTimeToLive`. The worker
 * runs the extensions; this side only routes calls to it, confines workspaces
 * to the files root, and puts a deadline on every call, because a worker that
 * has died leaves its caller waiting forever otherwise.
 *
 * Which extensions a host runs: for now VS Code's built-in `npm` extension,
 * taken from an installed VS Code-family app, since built-ins ship inside the
 * app rather than in an extensions folder.
 *
 * @internal
 */
import { NodeServices, NodeWorker } from "@effect/platform-node";
import { Worker } from "node:worker_threads";
import { Context, Duration, Effect, FileSystem, Layer, Option, Path, RcMap } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { resolveWithin } from "../fs";
import { ExtensionHostError, ExtensionHostRpcs, ViewRequestError } from "./protocol";

/** How long one host call may take, activation included on a cold start. */
const callDeadline = Duration.seconds(30);

/** A host with no callers is torn down after this. */
const idleTimeToLive = Duration.minutes(10);

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

  // A new host per workspace. The worker layer is built into the RcMap entry's
  // own scope, so the worker lives exactly as long as the entry: an
  // `Effect.provide` here would tear it down as soon as the client was made.
  const hosts = yield* RcMap.make({
    lookup: (workspace: string) =>
      Layer.build(
        RpcClient.layerProtocolWorker({ size: 1 }).pipe(
          Layer.provide(
            NodeWorker.layer(
              () =>
                new Worker(bootstrap, {
                  workerData: {
                    workspace,
                    extensions,
                  },
                }),
            ),
          ),
        ),
      ).pipe(Effect.flatMap((context) => RpcClient.make(ExtensionHostRpcs).pipe(Effect.provideContext(context)))),
    idleTimeToLive,
  });

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

  /** Run one call against the workspace's host, under the deadline. A
   * transport failure (the worker died, a message did not decode) and a missed
   * deadline both come back as a host error the client can show. */
  const withHost = <A, E>(requested: string, run: (client: RpcClient.FromGroup<typeof ExtensionHostRpcs, RpcClientError>) => Effect.Effect<A, E>) =>
    workspaceOf(requested).pipe(
      Effect.flatMap((workspace) => RcMap.get(hosts, workspace)),
      Effect.flatMap(run),
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: callDeadline,
        orElse: () => Effect.fail(hostError("Timeout", `the extension host for ${requested} did not answer within ${Duration.format(callDeadline)}`)),
      }),
      Effect.mapError((cause) =>
        cause instanceof ExtensionHostError || cause instanceof ViewRequestError
          ? cause
          : hostError("HostUnavailable", cause instanceof RpcClientError ? cause.message : String(cause)),
      ),
    );

  return {
    views: (workspace: string) => withHost(workspace, (client) => client.Views()),
    children: (workspace: string, view: string, parent: string | undefined) =>
      withHost(workspace, (client) =>
        client.Children({
          view,
          ...(parent === undefined ? {} : { parent }),
        }),
      ),
    invoke: (workspace: string, view: string, node: string, command: string) =>
      withHost(workspace, (client) =>
        client.Invoke({
          view,
          node,
          command,
        }),
      ),
  };
});

export class ExtensionViews extends Context.Service<ExtensionViews, Effect.Success<typeof make>>()("agent-console/ExtensionViews") {
  static readonly layer = Layer.effect(ExtensionViews, make).pipe(Layer.provide(NodeServices.layer));
}
