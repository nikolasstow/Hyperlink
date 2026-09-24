/**
 * Shared EAS build runner — fully headless. First makes sure the bundle id being
 * built has signing credentials (variant-credentials.ts creates them for a new
 * variant with no prompts; a no-op once they exist), then submits a
 * `--non-interactive` build. `--no-wait` returns as soon as it's submitted (the
 * cloud build runs on), printing the EAS link.
 */
import { Effect } from "effect";
import { runInherit } from "./command";
import { ensureVariantCredentials, resolveVariantTarget } from "./variant-credentials";

/** The EAS CLI isn't installed globally here — it runs via npx. */
const easCli = ["--yes", "eas-cli@24.7.0"];

export interface EasBuildOptions {
  readonly profile: "development" | "preview";
  readonly cwd: string;
}

export const runEasBuild = (options: EasBuildOptions) =>
  resolveVariantTarget(options.cwd).pipe(
    Effect.flatMap(ensureVariantCredentials),
    Effect.andThen(
      runInherit({
        command: "npx",
        args: [...easCli, "build", "-p", "ios", "--profile", options.profile, "--no-wait", "--non-interactive"],
        cwd: options.cwd,
      }),
    ),
  );
