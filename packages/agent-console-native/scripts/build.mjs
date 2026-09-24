/**
 * Build this worktree, three ways:
 *
 *   node scripts/build.mjs dev      # variant · development — dev client (Metro hot
 *                                   #   reload). The day-to-day build.
 *   node scripts/build.mjs preview  # variant · preview — this worktree as a real
 *                                   #   RELEASE build (no dev client / no hot reload),
 *                                   #   installed as this worktree's own app.
 *   node scripts/build.mjs master   # NON-variant · preview — builds THIS worktree's
 *                                   #   code as the single base app (release), replacing
 *                                   #   the one non-variant install. Works from any
 *                                   #   worktree/branch.
 *
 * dev/preview build this worktree's variant (they share its bundle id, so building one
 * replaces the other — one install per worktree). `master` sets the variant marker aside
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
  preview: { profile: "preview", base: false },
  master: { profile: "preview", base: true },
};

const mode = process.argv[2];
const cfg = MODES[mode];
if (cfg === undefined) {
  console.error(
    "Usage: node scripts/build.mjs <dev|preview|master>\n" +
      "  dev      variant · development — hot-reload dev client (day-to-day)\n" +
      "  preview  variant · preview — this worktree as a real release build\n" +
      "  master   NON-variant · preview — build THIS worktree's code as the single base app",
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
