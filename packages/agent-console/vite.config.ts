import { defineConfig, loadEnv } from "vite";
import { buildsPlugin } from "./src/server/buildsPlugin";
import { filesPlugin } from "./src/server/filesPlugin";
import { githubPlugin } from "./src/server/githubPlugin";
import { notificationsPlugin } from "./src/server/notificationsPlugin";
import { previewPlugin } from "./src/server/previewPlugin";
import { processesPlugin } from "./src/server/processesPlugin";

// Port kept off docs Waku (:5190) and the other example apps (:5177, :5189).
export default defineConfig(({ mode }) => {
  // Load AGENT_CONSOLE_* from .env into process.env so the server plugins (which
  // read process.env — e.g. the build-webhook secret) pick them up. Must run
  // before the plugins below are constructed.
  Object.assign(process.env, loadEnv(mode, process.cwd(), "AGENT_CONSOLE_"));
  return {
  plugins: [filesPlugin(), processesPlugin(), notificationsPlugin(), previewPlugin(), buildsPlugin(), githubPlugin()],
  server: {
    host: true,
    port: 5195,
    strictPort: true,
    allowedHosts: true,
  },
  };
});
