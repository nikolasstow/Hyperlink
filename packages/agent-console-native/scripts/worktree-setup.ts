/**
 * Per-worktree setup — runs automatically via the package's `prepare` script (on
 * `pnpm install`), so a worktree made in the terminal gets the same treatment as
 * one made in the app. Because this file is committed, it only runs on worktrees
 * whose branch carries it (self-propagating).
 *
 * Policy: the MAIN worktree stays the base app; every OTHER (linked) worktree
 * becomes its own installable variant, named after the worktree directory. All
 * steps are idempotent.
 *
 * It also installs a pre-commit guard so the per-worktree markers (which must stay
 * uncommitted — that's how EAS picks them up without them ever reaching a base
 * branch) can't be committed by accident.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Option, Path } from "effect";
import { slugify, variantIconFile, variantMarkerFile } from "../variant";
import { runString } from "./command";
import { genVariantIcon } from "./gen-variant-icon";

const guardMark = "hyperlink-variant-guard";

/** `app-variant\.json|assets/variant-icon\.png` — the markers, as an ERE alternation. */
const markerPattern = [variantMarkerFile, variantIconFile].map((file) => file.replace(/\./g, "\\.")).join("|");

const hookScript = `#!/bin/sh
# ${guardMark}: per-worktree variant markers must stay uncommitted.
if git diff --cached --name-only | grep -qE '(^|/)(${markerPattern})$'; then
  echo "✗ Refusing to commit a per-worktree variant marker (${variantMarkerFile} / ${variantIconFile})." >&2
  echo "  These are per-worktree and must stay uncommitted:  git restore --staged <file>" >&2
  exit 1
fi
`;

const git = (cwd: string, ...args: Array<string>) =>
  runString({
    command: "git",
    args,
    cwd,
  });

/** Block committing the per-worktree markers (they must stay uncommitted). Shared
 * across worktrees via the common hooks dir; never clobbers a foreign hook. */
const ensurePreCommitGuard = (pkgDir: string, commonDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hooksPath = yield* git(pkgDir, "config", "--default", "", "core.hooksPath");
    if (hooksPath !== "") return; // custom hooks path — leave it alone
    const hookPath = path.join(commonDir, "hooks", "pre-commit");
    const hookExists = yield* fs.exists(hookPath);
    if (hookExists) return; // already set (ours) or a foreign hook — don't clobber
    yield* fs.writeFileString(hookPath, hookScript);
    yield* fs.chmod(hookPath, 0o755);
    yield* Effect.log("installed pre-commit guard");
  });

const main = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pkgDir = path.resolve(import.meta.dirname, "..");

  // A prepare hook can run outside a git checkout (installed as a tarball) — git
  // exits non-zero there, a legitimate no-op. Any other failure surfaces.
  const layout = yield* Effect.all({
    gitDir: git(pkgDir, "rev-parse", "--absolute-git-dir"),
    commonDir: git(pkgDir, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    worktreeRoot: git(pkgDir, "rev-parse", "--show-toplevel"),
  }).pipe(
    Effect.map(Option.some),
    Effect.catchTag("CommandFailedError", () => Effect.succeed(Option.none())),
  );
  if (Option.isNone(layout)) return;
  const { gitDir, commonDir, worktreeRoot } = layout.value;

  yield* ensurePreCommitGuard(pkgDir, commonDir);

  // Main worktree → base app, nothing more to do.
  const isLinked = path.resolve(gitDir).startsWith(path.join(path.resolve(commonDir), "worktrees") + path.sep);
  if (!isLinked) return;

  // Linked worktree → its own variant, named after the worktree directory.
  const name = path.basename(worktreeRoot);
  if (slugify(name).length === 0) return;

  const markerPath = path.join(pkgDir, variantMarkerFile);
  const markerExists = yield* fs.exists(markerPath);
  if (!markerExists) {
    yield* fs.writeFileString(markerPath, `${JSON.stringify({ variant: name }, null, 2)}\n`);
    yield* Effect.log(`variant "${name}" (bundle id suffix .${slugify(name)})`);
  }

  const iconPath = path.join(pkgDir, variantIconFile);
  const iconExists = yield* fs.exists(iconPath);
  if (!iconExists) {
    yield* genVariantIcon({
      name,
      baseIcon: path.join(pkgDir, "assets", "icon.png"),
      out: iconPath,
    });
    yield* Effect.log(`icon → banner "${name.toUpperCase()}"`);
  }
});

main.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
