/**
 * Serves a rendered page so it can be opened with a REAL origin.
 *
 * The chat's inline preview renders the agent's HTML as an in-memory
 * `about:blank` document, which has no origin: scripts are constrained,
 * `fetch`/storage don't work, and there's nothing for a Safari-app hand-off to
 * point at. Serving the same HTML over HTTP gives it a real URL, so opening it
 * in a Safari view (SFSafariViewController) — and tapping through to the Safari
 * app from there — behaves like any hosted page.
 *
 * Content-addressed: the id is a hash of the HTML, so re-opening the same page
 * reuses its URL and posting is idempotent. The store is bounded and in-memory
 * — a preview is ephemeral, not state worth persisting.
 *
 * Self-contained documents are the supported case (as with the inline preview):
 * a single served document has no directory, so relative `src`/`href` won't
 * resolve. Multi-file pages are what the `/files/` route (filesPlugin) is for.
 *
 * @internal
 */
import { createHash } from "node:crypto";
import type { Connect, Plugin } from "vite";

const PREFIX = "/preview";
/** Bounded so a long-running server doesn't accumulate stale previews. Oldest
 * are evicted first; a re-post re-adds on demand. */
const MAX_ENTRIES = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readJson = async (req: Connect.IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
};

export const previewPlugin = (): Plugin => {
  // Insertion-ordered, so the first key is always the oldest for eviction.
  const store = new Map<string, string>();

  const put = (html: string): string => {
    const id = createHash("sha256").update(html).digest("hex").slice(0, 16);
    if (!store.has(id)) {
      store.set(id, html);
      while (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    }
    return id;
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (url !== PREFIX && !url.startsWith(`${PREFIX}/`) && !url.startsWith(`${PREFIX}?`)) {
      next();
      return;
    }
    const path = url.split("?")[0];

    // GET /preview/:id — serve the stored page as a real HTML document.
    if ((req.method === "GET" || req.method === "HEAD") && path.startsWith(`${PREFIX}/`)) {
      const id = path.slice(PREFIX.length + 1);
      const html = store.get(id);
      if (html === undefined) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Preview not found");
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }

    // POST /preview { html } — store and return the id/path to open.
    if (req.method === "POST" && path === PREFIX) {
      void (async () => {
        const body = await readJson(req);
        res.setHeader("Content-Type", "application/json");
        if (!isRecord(body) || typeof body.html !== "string" || body.html === "") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Expected { html: string }" }));
          return;
        }
        const id = put(body.html);
        res.statusCode = 200;
        res.end(JSON.stringify({ id, path: `${PREFIX}/${id}` }));
      })();
      return;
    }

    next();
  };

  return {
    name: "agent-console-preview",
    configureServer(server) {
      server.middlewares.use(handler);
    },
  };
};
