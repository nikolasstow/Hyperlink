/**
 * Proxies GitHub REST under `/github/*` → `https://api.github.com/*`.
 *
 * Native (and the web app) must not shell `gh` through OpenCode for search /
 * metadata — that is the wrong process and the wrong credential boundary.
 * Callers hit this origin instead; the Vite server forwards with optional
 * `GITHUB_TOKEN` / `GH_TOKEN` (else the GitHub CLI's signed-in token) so rate
 * limits and private visibility work from the machine running the console, not
 * from the phone.
 *
 * @internal
 */
import { execFileSync } from "node:child_process";
import type { Connect, Plugin } from "vite";

const PREFIX = "/github";
const GITHUB_API = "https://api.github.com";
/** GitHub requires a User-Agent; without it many endpoints 403. */
const USER_AGENT = "agent-console-github-proxy";

/** The GitHub CLI's token for this machine's signed-in account, read once:
 * without a token GitHub answers 404 for private repos. */
let ghCliToken: string | undefined | null = null;
const readGhCliToken = (): string | undefined => {
  if (ghCliToken !== null) return ghCliToken;
  try {
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5000 }).trim();
    ghCliToken = token.length > 0 ? token : undefined;
  } catch (error: unknown) {
    console.error("[github proxy] no GITHUB_TOKEN/GH_TOKEN and `gh auth token` failed; private repos will 404", error);
    ghCliToken = undefined;
  }
  return ghCliToken;
};

const githubToken = (): string | undefined => {
  const fromGithub = process.env.GITHUB_TOKEN;
  if (fromGithub !== undefined && fromGithub.length > 0) return fromGithub;
  const fromGh = process.env.GH_TOKEN;
  if (fromGh !== undefined && fromGh.length > 0) return fromGh;
  return readGhCliToken();
};

const handler: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? "";
  if (!url.startsWith(PREFIX)) {
    next();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  void (async () => {
    const suffix = url.slice(PREFIX.length);
    // `/github` alone is not a useful API path.
    if (suffix.length === 0 || suffix === "/") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Expected /github/<api path>" }));
      return;
    }

    const target = `${GITHUB_API}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = githubToken();
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;

    const upstream = await fetch(target, {
      method: req.method,
      headers,
    }).catch(() => undefined);

    if (upstream === undefined) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "GitHub unreachable" }));
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType !== null) res.setHeader("Content-Type", contentType);
    // Help callers see when they are unauthenticated vs token-backed.
    const remaining = upstream.headers.get("x-ratelimit-remaining");
    if (remaining !== null) res.setHeader("X-GitHub-RateLimit-Remaining", remaining);
    res.end(body);
  })();
};

export const githubPlugin = (): Plugin => ({
  name: "agent-console-github",
  configureServer(server) {
    server.middlewares.use(handler);
    const token = githubToken();
    server.config.logger.info(
      `  ->  github:  /github/* → api.github.com  (${token !== undefined ? "token" : "anonymous"})`,
    );
  },
});
