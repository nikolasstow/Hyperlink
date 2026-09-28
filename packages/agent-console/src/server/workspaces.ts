/**
 * The workspaces the app has told the backend about: the repo and worktree
 * folders it discovered (Home prefetches all of them) and any it opened.
 *
 * This is what "your repos" means to anything that acts on a folder: the
 * process runner only starts a process inside one of these, so a request can
 * never run something elsewhere on the machine, however it names the folder.
 *
 * @internal
 */
import { Context, Effect, Layer, Ref } from "effect";

const make = Effect.gen(function* () {
  const known = yield* Ref.make<ReadonlySet<string>>(new Set());
  return {
    /** Record workspaces, as resolved real paths. */
    register: (paths: ReadonlyArray<string>) => Ref.update(known, (current) => new Set([...current, ...paths])),
    /** Whether a resolved real path is one of the workspaces or inside one. */
    contains: (path: string) => Ref.get(known).pipe(Effect.map((all) => [...all].some((workspace) => path === workspace || path.startsWith(`${workspace}/`)))),
  };
});

export class Workspaces extends Context.Service<Workspaces, Effect.Success<typeof make>>()("agent-console/Workspaces") {
  static readonly layer = Layer.effect(Workspaces, make);
}
