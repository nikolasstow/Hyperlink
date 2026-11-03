import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv } from "vite";
import { buildsPlugin } from "./src/server/buildsPlugin";
import { filesPlugin } from "./src/server/filesPlugin";
import { githubPlugin } from "./src/server/githubPlugin";
import { notificationsPlugin } from "./src/server/notificationsPlugin";
import { previewPlugin } from "./src/server/previewPlugin";
import { processesPlugin } from "./src/server/processesPlugin";
import { adminTokenFile, stateDirectory } from "./src/server/sessions/files";

/** The Effect API server (serve.ts) the `/da` proxy forwards to. */
const apiServer = (): string => `http://127.0.0.1:${process.env.AGENT_CONSOLE_API_PORT ?? 5199}`;

/** The API's admin token, read per request so a server started after Vite is
 * picked up; undefined until the API server has made one. */
const adminToken = (): string | undefined => {
  try {
    return readFileSync(join(stateDirectory(join), adminTokenFile), "utf8").trim();
  } catch {
    return undefined;
  }
};

// Port kept off docs Waku (:5190) and the other example apps (:5177, :5189).
export default defineConfig(({ mode }) => {
  // Load AGENT_CONSOLE_* from .env into process.env so the server plugins (which
  // read process.env — e.g. the build-webhook secret) pick them up. Must run
  // before the plugins below are constructed.
  Object.assign(process.env, loadEnv(mode, process.cwd(), "AGENT_CONSOLE_"));
  return {
  plugins: [react(), filesPlugin(), processesPlugin(), notificationsPlugin(), previewPlugin(), buildsPlugin(), githubPlugin()],
  server: {
    host: true,
    port: 5195,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      // The browser talks to whatever origin it loaded the page from (e.g. a
      // Tailscale IP on a phone) — `127.0.0.1:4096` from client.ts would mean
      // "the phone itself" there, and opencode's own server only binds to
      // loopback by default anyway. Proxying through this (already
      // network-reachable) dev server means opencode never has to be exposed
      // to the network directly.
      "/opencode": {
        target: "http://127.0.0.1:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opencode/, ""),
      },
      // The Effect API server (projects, pages, the rendered page view). The
      // web app is on the same Mac as the server, so the proxy signs each
      // request with the admin token — the same trust the other dev-server
      // plugins already extend to whoever reaches :5195.
      "/da": {
        target: apiServer(),
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/da/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const token = adminToken();
            if (token !== undefined && token.length > 0) proxyReq.setHeader("authorization", `Bearer ${token}`);
          });
        },
      },
    },
  },
  };
});
