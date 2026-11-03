/**
 * The page SDK — the "special sauce". Every page the server renders gets this
 * script, which defines `window.da`. A page is author-written HTML, so the SDK
 * is the one thing the page can rely on being there.
 *
 * `window.da` gives a page:
 *
 * - **data**: `da.projects.list()`, `da.pages.list(project)`,
 *   `da.tasks.list(project)`, `da.repos.list()`, `da.sessions.list()`,
 *   `da.pages.get(project, slug)`. Each returns a Promise of JSON from the
 *   same API the app and the CLI use.
 * - **links**: `da.link.session(id)`, `da.link.file(repo, path)`,
 *   `da.link.page(project, slug)`. Each returns a string you put in an `<a
 *   href>` or pass to `da.open(...)`. In the browser it is a web route; in the
 *   app it is a `da:` link the WebView turns into native navigation.
 * - **chrome**: `da.chrome.set("fullscreen")` hides the app's nav bar, title
 *   and Dubz bar; `da.chrome.set("framed")` shows them. A no-op in the
 *   browser.
 * - **context**: `da.context.set({...})` hands context to Dubz, so the open
 *   page tells the assistant what it is about. A no-op in the browser.
 *
 * The SDK reads its config from `window.__DA__`, which the render route seeds
 * (env, project, slug) and the app WebView adds the auth token and `apiBase`
 * to. With no `apiBase` seeded, the SDK takes the API root from its own URL:
 * a page served at `/da/projects/view` (the web app's proxy) calls `/da/...`,
 * one served at `/projects/view` calls the origin root.
 *
 * This file is a plain string on purpose: the server inlines it into every
 * page. It runs in the page, not in Node, so it uses only browser globals.
 *
 * @internal
 */

/** The SDK source, inlined into every rendered page. */
export const DA_SDK_JS = `(() => {
  const cfg = window.__DA__ || (window.__DA__ = {});
  const env = cfg.env === "app" ? "app" : "browser";
  const apiBase = typeof cfg.apiBase === "string"
    ? cfg.apiBase
    : window.location.pathname.replace(new RegExp("/projects/view/?$"), "");
  const post = (msg) => {
    try {
      if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } catch (_e) { /* no bridge: ignore */ }
  };
  const get = (path) => {
    const headers = { Accept: "application/json" };
    if (cfg.token) headers.Authorization = "Bearer " + cfg.token;
    return fetch(apiBase + path, { headers }).then((r) => {
      if (!r.ok) throw new Error(path + " -> " + r.status);
      return r.json();
    });
  };
  const enc = encodeURIComponent;
  const link = {
    session: (id) => (env === "app" ? "da:session:" + id : "/session/" + enc(id)),
    file: (repo, p) => (env === "app" ? "da:file:" + repo + ":" + p : "/repo/" + enc(repo) + "#" + enc(p)),
    page: (project, slug) => (env === "app" ? "da:page:" + project + ":" + slug : apiBase + "/projects/view?project=" + enc(project) + "&slug=" + enc(slug)),
  };
  window.da = {
    env,
    apiBase,
    projects: { list: () => get("/projects") },
    pages: {
      list: (project) => get("/projects/" + enc(project) + "/pages"),
      get: (project, slug) => get("/projects/" + enc(project) + "/pages/" + enc(slug)),
    },
    tasks: { list: (project) => get("/projects/" + enc(project) + "/tasks") },
    repos: { list: () => get("/projects-repos") },
    sessions: { list: () => get("/projects-sessions") },
    link,
    open: (href) => {
      if (env === "app") post({ type: "navigate", href });
      else window.location.href = href;
    },
    chrome: { set: (mode) => post({ type: "chrome", mode: mode === "fullscreen" ? "fullscreen" : "framed" }) },
    context: { set: (context) => post({ type: "context", context }) },
  };
  // In the app, a click on an anchor with a da: href goes through the bridge
  // so navigation is native, not a failed page load.
  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (anchor && anchor.getAttribute("href") && anchor.getAttribute("href").indexOf("da:") === 0) {
      event.preventDefault();
      window.da.open(anchor.getAttribute("href"));
    }
  });
})();`;
