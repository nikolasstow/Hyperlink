/**
 * Build this worktree, three ways:
 *
 *   node scripts/build.mjs dev      # variant · development — dev client (Metro hot
 *                                   #   reload). The day-to-day build.
 *   node scripts/build.mjs release  # variant · preview — this worktree as a real
 *                                   #   RELEASE build (no dev client / no hot reload),
 *                                   #   installed as this worktree's own app.
 *   node scripts/build.mjs base     # NON-variant · preview — builds THIS worktree's
 *                                   #   code as the single base app (release), replacing
 *                                   #   the one non-variant install. Works from any
 *                                   #   worktree/branch.
 *
 * dev/release build this worktree's variant (they share its bundle id, so building one
 * replaces the other — one install per worktree). `base` sets the variant marker aside
 * for the upload so the config resolves to the base id, then restores it.
 */
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEasBuild } from "./eas-build.mjs";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = path.join(pkgDir, "app-variant.json");

const MODES = {
  dev: { profile: "development", base: false },
  release: { profile: "preview", base: false },
  base: { profile: "preview", base: true },
};

const mode = process.argv[2];
const cfg = MODES[mode];
if (cfg === undefined) {
  console.error(
    "Usage: node scripts/build.mjs <dev|release|base>\n" +
      "  dev      variant · development — hot-reload dev client (day-to-day)\n" +
      "  release  variant · preview — this worktree as a real release build\n" +
      "  base     NON-variant · preview — build THIS worktree's code as the single base app",
  );
  process.exit(1);
}

if (!cfg.base) {
  // Build this worktree's variant (keeps app-variant.json in place).
  process.exitCode = runEasBuild({ profile: cfg.profile, cwd: pkgDir });
} else {
  // Build the base (non-variant) from this worktree: set the variant marker aside so
  // the config resolves to the base id for the upload, then restore it afterwards.
  console.log("⚠ Building the BASE app (com.nikolasstow.agentconsolenative) from this worktree — this replaces the one non-variant install.");
  const aside = `${marker}.build-aside`;
  const hadMarker = existsSync(marker);
  if (hadMarker) renameSync(marker, aside);
  try {
    process.exitCode = runEasBuild({ profile: "preview", cwd: pkgDir });
  } finally {
    if (hadMarker) renameSync(aside, marker);
  }
}
