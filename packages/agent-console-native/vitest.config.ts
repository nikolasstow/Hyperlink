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
  },
});
