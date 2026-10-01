/**
 * Making a session's new folder on its server, as the outbox's first step for
 * a session in a folder that does not exist yet (nothing is made before the
 * message is sent). The app's layer is in foldersNative.ts (opencode's
 * repo-admin shell, through the v1 client); `layerNone` refuses (tests,
 * scripts).
 *
 * @internal
 */
import { Context, Effect, Layer } from "effect";
import type { ServerAddress } from "../opencode/serverAddress";

export interface FoldersShape {
  /** Makes `name` under `root` (`root` as typed, perhaps `~`-relative) and
   * answers its absolute path. Making one that exists is not a failure. */
  readonly make: (server: ServerAddress, root: string, name: string) => Effect.Effect<string, unknown>;
}

export class Folders extends Context.Service<Folders, FoldersShape>()("@doubleagent/outbox/Folders") {
  static readonly layerNone = Layer.succeed(Folders)({
    make: (_server, root, name) => Effect.fail(new Error(`No way to make folders here (${root}/${name}).`)),
  });
}
