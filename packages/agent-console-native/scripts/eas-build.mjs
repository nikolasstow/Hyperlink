/**
 * Shared EAS build runner — fully headless. First makes sure the bundle id being
 * built has signing credentials (scripts/variant-credentials.mjs creates them for a
 * new variant with no prompts; a no-op once they exist), then submits a
 * `--non-interactive` build. `--no-wait` returns as soon as it's submitted (the
 * cloud build runs on), printing the EAS link. Returns the exit code.
 */
import { spawnSync } from "node:child_process";
import { ensureVariantCredentials, resolveBundleIdentifier } from "./variant-credentials.mjs";

/** The EAS CLI isn't installed globally here — it runs via npx. */
export const EAS = ["npx", "--yes", "eas-cli@24.7.0"];

export const runEasBuild = async ({ profile, cwd }) => {
  await ensureVariantCredentials(resolveBundleIdentifier(cwd));
  const args = ["build", "-p", "ios", "--profile", profile, "--no-wait", "--non-interactive"];
  console.log(`\n→ ${EAS.join(" ")} ${args.join(" ")}  (in ${cwd})`);
  return spawnSync(EAS[0], [...EAS.slice(1), ...args], { cwd, stdio: "inherit" }).status ?? 1;
};
