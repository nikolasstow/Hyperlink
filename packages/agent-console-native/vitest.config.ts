/**
 * Only the pure, server-free helpers are tested here (`providerAuth.ts`) —
 * the screens themselves need a device. Node environment, same shape as
 * `packages/agent-console`'s config.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The suite is empty whenever no prototype carrying tests is merged in.
    // That is a real state, not a failure — a prototype branch brings its own
    // tests with it and they run then.
    passWithNoTests: true,
  },
});
