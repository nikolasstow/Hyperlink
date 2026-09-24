/**
 * Shared EAS build runner. Tries a HEADLESS build first (works with no prompts
 * once the ASC API key is assigned to build credentials — `eas credentials -p ios`),
 * and only falls back to an interactive build when the failure is a new bundle id's
 * missing credentials. `--no-wait` returns as soon as it's submitted (the cloud
 * build runs on), printing the EAS link. Returns the exit code.
 */
import { spawnSync } from "node:child_process";

/** The EAS CLI isn't installed globally here — it runs via npx. */
export const EAS = ["npx", "--yes", "eas-cli@24.7.0"];

export const runEasBuild = ({ profile, cwd }) => {
  const args = ["build", "-p", "ios", "--profile", profile, "--no-wait"];
  console.log(`\n→ ${EAS.join(" ")} ${args.join(" ")} --non-interactive  (in ${cwd})`);
  const headless = spawnSync(EAS[0], [...EAS.slice(1), ...args, "--non-interactive"], { cwd, encoding: "utf8" });
  process.stdout.write(headless.stdout ?? "");
  process.stderr.write(headless.stderr ?? "");
  if (headless.status === 0) return 0;

  const needsCredentials = /interactive mode|couldn.?t find any credentials|Failed to set up credentials/i.test(
    `${headless.stdout ?? ""}${headless.stderr ?? ""}`,
  );
  if (!needsCredentials) return headless.status ?? 1;

  if (!process.stdin.isTTY) {
    console.error(
      "✗ This bundle id has no credentials yet and there's no interactive terminal here.\n" +
        `  Run from your own terminal, or assign the ASC key once:  ${EAS.join(" ")} credentials -p ios`,
    );
    return 1;
  }
  console.log("\nℹ New bundle id has no credentials yet — re-running interactively so EAS can create them (uses your ASC key).\n");
  return spawnSync(EAS[0], [...EAS.slice(1), ...args], { cwd, stdio: "inherit" }).status ?? 1;
};
