/**
 * `Folders` in the app: opencode's repo-admin shell on the server, through the
 * v1 client (repoCreate.ts), one client per server.
 *
 * @internal
 */
import { Effect, Layer } from "effect";
import { makeClient } from "../client";
import type { ServerAddress } from "../opencode/serverAddress";
import { createWorkspaceFolder } from "../repoCreate";
import { Folders } from "./Folders";

export const layer = Layer.sync(Folders)(() => {
  const clients = new Map<ServerAddress, ReturnType<typeof makeClient>>();
  const clientOf = (server: ServerAddress) => {
    const known = clients.get(server);
    if (known !== undefined) return known;
    const client = makeClient(server);
    clients.set(server, client);
    return client;
  };
  return {
    make: (server, root, name) =>
      Effect.tryPromise({
        try: () => createWorkspaceFolder(clientOf(server), root, name),
        catch: (cause) => cause,
      }),
  };
});
