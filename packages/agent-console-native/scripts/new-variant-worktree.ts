/**
 * Create a git worktree AND wire it up as its own installable app variant.
 *
 * A worktree is a linked checkout of a branch (shares the repo's .git), so a
 * build from it produces that branch's app. Pairing each worktree with a
 * distinct bundle identifier (see app.config.js) lets every worktree install
 * side by side as a separate app with its own sandboxed storage — one worktree
 * ⇄ one install ⇄ one local agent, none colliding.
 *
 *   pnpm variant:new <name> [--base <branch>] [--build]
 *
 *   <name>          Worktree/variant name (also the branch name). Its slug becomes
 *                   the bundle-id suffix + app name.
 *   --base <branch> Branch/commit to fork from (default: current HEAD).
 *   --build         Immediately start the EAS iOS dev build — fully headless; a new
 *                   variant's signing credentials are created automatically.
 *                   Omit to skip: EAS builds are remote, ~10-20 min and metered.
 *
 * Per-worktree setup (variant marker + banner icon) happens in the new worktree's
 * `pnpm install`, via the package's `prepare` hook (scripts/worktree-setup.ts) — the
 * single source of truth, so a plain `git worktree add` gets the same setup.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Data, Effect, FileSystem, Layer, Path } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { FetchHttpClient } from "effect/unstable/http";
import packageJson from "../package.json" with { type: "json" };
import { slugify } from "../variant";
import { probe, runInherit } from "./command";
import { runEasBuild } from "./eas-build";

class InvalidVariantError extends Data.TaggedError("InvalidVariantError")<{
  readonly message: string;
}> {}

const packageSubpath = "packages/agent-console-native";

const newVariant = Command.make("variant:new", {
  name: Argument.string("name").pipe(Argument.withDescription("Worktree / variant name (also the branch name).")),
  base: Flag.string("base").pipe(
    Flag.withDescription("Branch/commit to fork from."),
    Flag.withDefault("HEAD"),
  ),
  build: Flag.boolean("build").pipe(Flag.withDescription("Start the EAS dev build right away (headless).")),
}).pipe(
  Command.withDescription("Create a git worktree wired up as its own installable app variant."),
  Command.withHandler(({ name, base, build }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      // This script lives at <repoRoot>/packages/agent-console-native/scripts, so the
      // repo (worktree) root is three levels up — works from any cwd.
      const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

      const slug = slugify(name);
      if (slug.length === 0) {
        return yield* new InvalidVariantError({
          message: `"${name}" has no usable slug (need at least one alphanumeric character).`,
        });
      }

      // Siblings (other worktrees) live next to this one.
      const dest = path.join(path.dirname(repoRoot), slug);
      const destExists = yield* fs.exists(dest);
      if (destExists) {
        return yield* new InvalidVariantError({
          message: `${dest} already exists — pick another name or remove it first.`,
        });
      }

      // Reuse the branch if it already exists, else create it from base. The slug is
      // the branch name (branch-safe: the variant name may have spaces/caps).
      const branchExists = yield* probe({
        command: "git",
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${slug}`],
        cwd: repoRoot,
      });
      yield* runInherit({
        command: "git",
        args: branchExists ? ["worktree", "add", dest, slug] : ["worktree", "add", "-b", slug, dest, base],
        cwd: repoRoot,
      });

      // Install deps — fires the package's `prepare` hook (worktree-setup.ts), which
      // writes the variant marker + banner icon. Also required before a build.
      yield* Effect.log("pnpm install (runs the worktree-setup prepare hook)…");
      yield* runInherit({
        command: "pnpm",
        args: ["install"],
        cwd: dest,
      });

      const pkgCwd = path.join(dest, packageSubpath);
      if (!build) {
        yield* Effect.log(`Worktree ready at ${dest} — variant "${slug}". Dev build:  cd ${pkgCwd} && pnpm build:dev`);
        return;
      }
      yield* runEasBuild({
        profile: "development",
        cwd: pkgCwd,
      });
    }),
  ),
);

Command.run(newVariant, { version: packageJson.version }).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  NodeRuntime.runMain,
);
