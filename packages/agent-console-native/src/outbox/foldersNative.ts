/**
 * `Folders` in the app: a `mkdir` on the server (repoCreate.ts).
 *
 * @internal
 */
import { Effect, Layer } from "effect";
import { createWorkspaceFolder } from "../repoCreate";
import { Folders } from "./Folders";

export const layer = Layer.succeed(Folders)({
  make: (server, root, name) =>
    Effect.tryPromise({
      try: () => createWorkspaceFolder(server, root, name),
      catch: (cause) => cause,
    }),
});
