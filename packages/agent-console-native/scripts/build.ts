/**
 * Build this worktree, three ways:
 *
 *   pnpm build:dev      # variant · development — dev client (Metro hot reload).
 *                       #   The day-to-day build.
 *   pnpm build:preview  # variant · preview — this worktree as a real RELEASE build
 *                       #   (no dev client / no hot reload), installed as this
 *                       #   worktree's own app.
 *   pnpm build:master   # NON-variant · preview — builds THIS worktree's code as the
 *                       #   single base app (release), replacing the one non-variant
 *                       #   install. Works from any worktree/branch.
 *
 * dev/preview build this worktree's variant (they share its bundle id, so building one
 * replaces the other — one install per worktree). `master` sets the variant marker aside
 * for the upload so the config resolves to the base id, then restores it.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import packageJson from "../package.json" with { type: "json" };
import { type EasBuildOptions, runEasBuild } from "./eas-build";

const profiles: Record<"dev" | "preview" | "master", EasBuildOptions["profile"]> = {
  dev: "development",
  preview: "preview",
  master: "preview",
};

/** Run `build` with the variant marker set aside (so the config resolves to the base
 * id), restoring it however the build ends. */
const withMarkerAside = <A, E, R>(pkgDir: string, build: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const marker = path.join(pkgDir, "app-variant.json");
    const aside = `${marker}.build-aside`;
    const hadMarker = yield* fs.exists(marker);
    if (!hadMarker) return yield* build;
    return yield* Effect.acquireUseRelease(
      fs.rename(marker, aside),
      () => build,
      () => Effect.orDie(fs.rename(aside, marker)),
    );
  });

const build = Command.make("build", {
  mode: Argument.choice("mode", ["dev", "preview", "master"]).pipe(
    Argument.withDescription("dev / preview build this worktree's variant; master builds the base app."),
  ),
}).pipe(
  Command.withDescription("Build this worktree on EAS (headless — new variants get signing credentials automatically)."),
  Command.withHandler(({ mode }) =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const pkgDir = path.resolve(import.meta.dirname, "..");
      const run = runEasBuild({
        profile: profiles[mode],
        cwd: pkgDir,
      });
      if (mode !== "master") return yield* run;
      yield* Effect.log("Building the BASE app from this worktree — this replaces the one non-variant install.");
      return yield* withMarkerAside(pkgDir, run);
    }),
  ),
);

Command.run(build, { version: packageJson.version }).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
