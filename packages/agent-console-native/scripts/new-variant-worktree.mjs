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
  console.log(`  Build & install:  cd ${pkgCwd} && ${EAS.join(" ")} build -p ios --profile development`);
  process.exit(0);
}

const buildArgs = ["build", "-p", "ios", "--profile", "development", "--no-wait"];

// Try HEADLESS first. This succeeds with no prompts once the ASC API key is
// assigned to the project's build credentials (`eas credentials -p ios` → App Store
// Connect API Key), which lets EAS create a new variant's cert + profile silently.
console.log(`\n→ ${EAS.join(" ")} ${buildArgs.join(" ")} --non-interactive  (in ${pkgCwd})`);
const headless = spawnSync(EAS[0], [...EAS.slice(1), ...buildArgs, "--non-interactive"], { cwd: pkgCwd, encoding: "utf8" });
process.stdout.write(headless.stdout ?? "");
process.stderr.write(headless.stderr ?? "");
if (headless.status === 0) process.exit(0);

// Fall back to INTERACTIVE only when the failure is the new bundle id's missing
// credentials — anything else is a real error, don't silently re-run it.
const needsCredentials = /interactive mode|couldn.?t find any credentials|Failed to set up credentials/i.test(
  `${headless.stdout ?? ""}${headless.stderr ?? ""}`,
);
if (!needsCredentials) process.exit(headless.status ?? 1);

if (!process.stdin.isTTY) {
  fail(
    "This variant's credentials don't exist yet and there's no interactive terminal here.\n" +
      "Either run this from your own terminal, or wire the ASC key once so builds are headless:\n" +
      `  ${EAS.join(" ")} credentials -p ios   → App Store Connect API Key → assign "[Expo] EAS Submit"`,
  );
}
console.log("\nℹ New bundle id has no credentials yet — re-running interactively so EAS can create them (uses your ASC key).");
console.log("   Assign the ASC key once (eas credentials -p ios) and future variants build headless.\n");
const interactive = spawnSync(EAS[0], [...EAS.slice(1), ...buildArgs], { cwd: pkgCwd, stdio: "inherit" });
process.exit(interactive.status ?? 1);
