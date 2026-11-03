/**
 * Renders a page to a full HTML document with the SDK (sdk.ts) injected, for
 * both the browser and the app WebView.
 *
 * - An **HTML** page is the author's own document. The SDK goes in just before
 *   `</head>` (or at the top when there is no head), so `window.da` is ready
 *   before the page's own scripts run. A fragment with no `<html>` is wrapped
 *   in a minimal document first.
 * - A **Markdown** page is wrapped in a small styled document. `marked` from a
 *   CDN turns the Markdown into HTML in the page. This needs the network; the
 *   prototype accepts that (Decisions, in the handoff doc).
 * - A **tsx** page is not rendered yet; the document says so.
 *
 * The render route (serve.ts) seeds `window.__DA__` with `env`, `apiBase`,
 * `project` and `slug`; the app WebView adds the auth token before the page
 * loads.
 *
 * @internal
 */
import { Page } from "./model";
import { DA_SDK_JS } from "./sdk";

/** The `window.__DA__` seed and the SDK, as one script block. */
const sdkBlock = (env: "app" | "browser", apiBase: string, project: string, slug: string): string => {
  const config = JSON.stringify({ env, apiBase, project, slug });
  return `<script>window.__DA__=Object.assign(${config},window.__DA__||{});</script><script>${DA_SDK_JS}</script>`;
};

/** Put the SDK block into an author's HTML document. */
const injectIntoHtml = (html: string, block: string): string => {
  const headClose = html.search(/<\/head>/i);
  if (headClose !== -1) return `${html.slice(0, headClose)}${block}${html.slice(headClose)}`;
  const bodyOpen = /<body[^>]*>/i.exec(html);
  if (bodyOpen?.index !== undefined) {
    const at = bodyOpen.index + bodyOpen[0].length;
    return `${html.slice(0, at)}${block}${html.slice(at)}`;
  }
  // A fragment, not a document: wrap it.
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${block}</head><body>${html}</body></html>`;
};

/** A minimal styled document for a Markdown page, rendered with `marked`. */
const markdownDocument = (title: string, markdown: string, block: string): string => {
  const data = JSON.stringify(markdown);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 24px 16px; max-width: 760px; margin-inline: auto; font: 16px/1.6 -apple-system, system-ui, sans-serif; }
pre { overflow:auto; padding:12px; border-radius:10px; background: color-mix(in srgb, currentColor 8%, transparent); }
code { font-family: ui-monospace, Menlo, monospace; }
a { color: #3b82f6; }
</style>
${block}
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/14.1.2/marked.min.js"></script>
</head>
<body>
<article id="content"></article>
<script>
  const source = ${data};
  const target = document.getElementById("content");
  if (window.marked && window.marked.parse) target.innerHTML = window.marked.parse(source);
  else { const pre = document.createElement("pre"); pre.textContent = source; target.appendChild(pre); }
</script>
</body>
</html>`;
};

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unsupportedDocument = (page: Page, block: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.title)}</title>${block}</head><body style="font:16px/1.6 system-ui,sans-serif;padding:24px"><h1>${escapeHtml(page.title)}</h1><p>This page is a <code>${escapeHtml(page.kind)}</code> page. The prototype renders <code>html</code> and <code>md</code> pages only.</p></body></html>`;

/** The full HTML document for a page. */
export const renderPage = (page: Page, options: { env: "app" | "browser"; apiBase: string }): string => {
  const block = sdkBlock(options.env, options.apiBase, page.project, page.slug);
  if (page.kind === "html") return injectIntoHtml(page.content, block);
  if (page.kind === "md") return markdownDocument(page.title, page.content, block);
  return unsupportedDocument(page, block);
};
