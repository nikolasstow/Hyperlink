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
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { genVariantIcon } from "./gen-variant-icon.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetsDir = path.join(pkgDir, "assets");
const git = (...a) => execFileSync("git", a, { cwd: pkgDir, encoding: "utf8" }).trim();

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

const GUARD_MARK = "hyperlink-variant-guard";

/** Block committing the per-worktree markers (they must stay uncommitted). Shared
 * across worktrees via the common hooks dir; never clobbers a foreign hook. */
const ensurePreCommitGuard = (commonDir) => {
  if (git("config", "--default", "", "core.hooksPath") !== "") return; // custom hooks path — leave it alone
  const hookPath = path.join(path.resolve(commonDir), "hooks", "pre-commit");
  if (existsSync(hookPath)) return; // already set (ours) or a foreign hook — don't clobber
  const hook = `#!/bin/sh
# ${GUARD_MARK}: per-worktree variant markers must stay uncommitted.
if git diff --cached --name-only | grep -qE '(^|/)(app-variant\\.json|assets/variant-icon\\.png)$'; then
  echo "✗ Refusing to commit a per-worktree variant marker (app-variant.json / assets/variant-icon.png)." >&2
  echo "  These are per-worktree and must stay uncommitted:  git restore --staged <file>" >&2
  exit 1
fi
`;
  writeFileSync(hookPath, hook);
  chmodSync(hookPath, 0o755);
  console.log("[worktree-setup] installed pre-commit guard");
};

// A prepare hook can run where there's no git (installed as a tarball) — that's a
// legitimate no-op, not an error to surface.
let gitDir;
let commonDir;
let worktreeRoot;
try {
  gitDir = git("rev-parse", "--absolute-git-dir");
  commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  worktreeRoot = git("rev-parse", "--show-toplevel");
} catch {
  process.exit(0);
}

ensurePreCommitGuard(commonDir);

// Main worktree → base app, nothing more to do.
const isLinked = path.resolve(gitDir).startsWith(path.join(path.resolve(commonDir), "worktrees") + path.sep);
if (!isLinked) process.exit(0);

// Linked worktree → its own variant, named after the worktree directory.
const name = path.basename(worktreeRoot);
const slug = slugify(name);
if (slug.length === 0) process.exit(0);

const variantFile = path.join(pkgDir, "app-variant.json");
if (!existsSync(variantFile)) {
  writeFileSync(variantFile, `${JSON.stringify({ variant: name }, null, 2)}\n`);
  console.log(`[worktree-setup] variant "${name}" → com.nikolasstow.agentconsolenative.${slug}`);
}

const iconOut = path.join(assetsDir, "variant-icon.png");
if (!existsSync(iconOut)) {
  await genVariantIcon({ name, baseIcon: path.join(assetsDir, "icon.png"), out: iconOut });
  console.log(`[worktree-setup] icon → banner "${name.toUpperCase()}"`);
}
