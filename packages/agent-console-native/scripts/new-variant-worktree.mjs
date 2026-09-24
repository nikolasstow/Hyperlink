#!/usr/bin/env node
/**
 * Create a git worktree AND wire it up as its own installable app variant.
 *
 * A worktree is a linked checkout of a branch (shares the repo's .git), so a
 * build from it produces that branch's app. Pairing each worktree with a
 * distinct bundle identifier (see app.config.js) lets every worktree install
 * side by side as a separate app with its own sandboxed storage — one worktree
 * ⇄ one install ⇄ one local agent, none colliding.
 *
 *   node scripts/new-variant-worktree.mjs <name> [--base <branch>] [--build]
 *
 *   <name>          Worktree/variant name (also the default branch name). The
 *                   slug of it becomes the bundle-id suffix + app name.
 *   --base <branch> Branch/commit to fork from (default: current HEAD).
 *   --build         Immediately start the EAS iOS build (development profile).
 *                   Omit to just print the command — EAS builds are remote,
 *                   ~10-20 min and metered, so building is opt-in.
 *
 * The variant is selected by an uncommitted `app-variant.json` this writes into
 * the new worktree's package (app.config.js reads it), so an EAS *cloud* build —
 * which evaluates the config on its servers — picks it up without any env
 * forwarding. `APP_VARIANT` is also exported for the (optional) build here.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEasBuild } from "./eas-build.mjs";

const PACKAGE_SUBPATH = "packages/agent-console-native";
/** This script lives at <repoRoot>/packages/agent-console-native/scripts, so the
 * repo (worktree) root is three levels up — computed from the script's own
 * location, so it works no matter where you run it from. */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");

const args = process.argv.slice(2);
const doBuild = args.includes("--build");
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "HEAD";
const name = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

if (name === undefined || name.length === 0) {
  fail("Usage: node scripts/new-variant-worktree.mjs <name> [--base <branch>] [--build]");
}

const slug = name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 24);
if (slug.length === 0) fail(`"${name}" has no usable slug (need at least one alphanumeric character).`);

// All git runs against the repo root, so this works from any cwd.
const git = (...a) => spawnSync("git", ["-C", repoRoot, ...a], { stdio: "inherit" });

// Siblings (other worktrees) live next to this one.
const dest = path.join(path.dirname(repoRoot), slug);
if (existsSync(dest)) fail(`${dest} already exists — pick another name or remove it first.`);

// Reuse the branch if it already exists, else create it from base. Use the slug
// (branch-safe: the variant name may have spaces/caps for display).
const branch = slug;
const branchExists =
  spawnSync("git", ["-C", repoRoot, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;

console.log(`→ git worktree add ${dest} (${branchExists ? branch : `-b ${branch} ${base}`})`);
const addArgs = branchExists ? ["worktree", "add", dest, branch] : ["worktree", "add", "-b", branch, dest, base];
if (git(...addArgs).status !== 0) fail("git worktree add failed.");

const pkgCwd = path.join(dest, PACKAGE_SUBPATH);

// Install deps — this fires the package's `prepare` hook (scripts/worktree-setup.mjs),
// which is the single source of truth for per-worktree setup: it writes the variant
// marker + banner icon (a linked worktree becomes a variant named after itself). A
// worktree made with plain `git worktree add` gets the exact same setup on its own
// install. Install is also required before a build (eas evaluates the config locally).
console.log("\n→ pnpm install (runs the worktree-setup prepare hook)…");
if (spawnSync("pnpm", ["install"], { cwd: dest, stdio: "inherit" }).status !== 0) {
  fail("pnpm install failed in the new worktree.");
}

if (!doBuild) {
  console.log(`\n✓ Worktree ready at ${dest} — variant "${slug}".`);
  console.log(`  Dev build:  cd ${pkgCwd} && pnpm build:dev`);
  process.exit(0);
}

// A dev-client build for the new variant (hot-reload development). Other modes live
// in scripts/build.mjs (pnpm build:release / build:base).
process.exit(runEasBuild({ profile: "development", cwd: pkgCwd }));
