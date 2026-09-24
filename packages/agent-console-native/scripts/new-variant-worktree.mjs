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
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SUBPATH = "packages/agent-console-native";
/** The EAS CLI isn't installed globally here — it runs via npx. */
const EAS = ["npx", "--yes", "eas-cli@24.7.0"];
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

// Select the variant for that worktree (app.config.js reads this file).
const variantFile = path.join(dest, PACKAGE_SUBPATH, "app-variant.json");
writeFileSync(variantFile, `${JSON.stringify({ variant: name }, null, 2)}\n`);
console.log(`✓ wrote ${path.relative(dest, variantFile)} → variant "${name}" (bundle id …agentconsolenative.${slug})`);

const buildCwd = path.join(dest, PACKAGE_SUBPATH);
const buildCmd = `${EAS.join(" ")} build -p ios --profile development`;

if (!doBuild) {
  console.log("\nWorktree ready. To build & install this variant:");
  console.log(`  cd ${buildCwd}`);
  console.log(`  ${buildCmd}`);
  console.log("\n(Then install from the EAS build link. Re-run with --build to start it now.)");
  process.exit(0);
}

// Interactive on purpose: a new variant's bundle id needs its credentials created
// once, which EAS will only do with a real terminal (it auto-detects a non-TTY as
// non-interactive and refuses). Run this from your own terminal for that first build.
console.log(`\n→ ${buildCmd}\n  (in ${buildCwd})`);
const build = spawnSync(EAS[0], [...EAS.slice(1), "build", "-p", "ios", "--profile", "development"], {
  cwd: buildCwd,
  stdio: "inherit",
  env: { ...process.env, APP_VARIANT: name },
});
process.exit(build.status ?? 1);
