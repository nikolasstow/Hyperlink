/**
 * The demo data for the prototype: real projects from the handoffs, and the
 * owner's home page. `da seed` (cli/da.ts) writes this to the local store so
 * the demo shows real work, not lorem ipsum.
 *
 * The owner is focused on 3D resin printing now, so the `printing` project is
 * pinned and dominant on the home page; everything else stays reachable.
 *
 * The home page is itself a page in the special `home` project — the owner's
 * private site. It uses the SDK (sdk.ts): it lists the projects, groups them
 * by category, and asks for the printing project's tasks.
 *
 * @internal
 */
import { Effect } from "effect";
import { ProjectInput } from "agent-console-protocol/Projects";
import { ProjectsStore } from "./store";

type Seed = {
  readonly slug: string;
  readonly project: ProjectInput;
  readonly pages: ReadonlyArray<{ readonly slug: string; readonly kind: "html" | "md"; readonly author: string; readonly content: string }>;
};

/** The home page: the owner's private site. Printing dominant, the rest
 * reachable. It reads everything through `window.da`. */
const HOME_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Projects</title>
<style>
  :root { color-scheme: light dark; --bg:#0b0b0f; --fg:#f4f4f6; --muted:#9aa0ac; --card:#15161c; --line:#262732; --accent:#6ea8fe; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --fg:#14151a; --muted:#5b6472; --card:#ffffff; --line:#e6e8ee; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system, system-ui, sans-serif; padding:20px 16px 48px; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
  h1 { font-size:22px; margin:0; }
  button { font:inherit; color:var(--fg); background:var(--card); border:1px solid var(--line); border-radius:999px; padding:6px 14px; }
  .hero { border:1px solid var(--line); background:linear-gradient(160deg, color-mix(in srgb, var(--accent) 22%, var(--card)), var(--card)); border-radius:16px; padding:18px; margin-bottom:22px; }
  .hero h2 { margin:0 0 4px; font-size:19px; }
  .hero p { margin:0 0 12px; color:var(--muted); }
  .cat { color:var(--muted); font-size:13px; text-transform:uppercase; letter-spacing:.06em; margin:22px 0 8px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
  a.card { display:block; text-decoration:none; color:inherit; border:1px solid var(--line); background:var(--card); border-radius:14px; padding:14px; }
  a.card:active { transform:scale(.99); }
  .card h3 { margin:0 0 4px; font-size:16px; }
  .card small { color:var(--muted); }
  ul.tasks { list-style:none; padding:0; margin:10px 0 0; }
  ul.tasks li { padding:6px 0; border-top:1px solid var(--line); color:var(--muted); font-size:14px; }
  .empty { color:var(--muted); }
</style>
</head>
<body>
<header>
  <h1>Projects</h1>
  <button id="chrome">Fullscreen</button>
</header>
<div id="hero" class="hero"><p class="empty">Loading…</p></div>
<div id="rest"></div>
<script>
  // Show the app nav + Dubz bar by default; the page is framed.
  if (window.da) window.da.chrome.set("framed");
  let full = false;
  document.getElementById("chrome").addEventListener("click", () => {
    full = !full;
    if (window.da) window.da.chrome.set(full ? "fullscreen" : "framed");
    document.getElementById("chrome").textContent = full ? "Show bars" : "Fullscreen";
  });

  const firstPageHref = async (slug) => {
    try {
      const pages = await window.da.pages.list(slug);
      if (pages.length > 0) return window.da.link.page(slug, pages[0].slug);
    } catch (_e) { /* fall through */ }
    return window.da.link.page(slug, "home");
  };

  const card = async (project) => {
    const href = await firstPageHref(project.slug);
    const a = document.createElement("a");
    a.className = "card";
    a.href = href;
    a.innerHTML = "<h3>" + project.name + "</h3><small>" + project.description + "</small>";
    return a;
  };

  (async () => {
    let projects = [];
    try { projects = await window.da.projects.list(); }
    catch (e) { document.getElementById("hero").innerHTML = "<p class='empty'>Could not load projects: " + e.message + "</p>"; return; }

    const printing = projects.find((p) => p.slug === "printing");
    const hero = document.getElementById("hero");
    if (printing) {
      hero.innerHTML = "<h2>" + printing.name + "</h2><p>" + printing.description + "</p>";
      const open = document.createElement("button");
      open.textContent = "Open";
      open.addEventListener("click", async () => window.da.open(await firstPageHref("printing")));
      hero.appendChild(open);
      const list = document.createElement("ul");
      list.className = "tasks";
      hero.appendChild(list);
      try {
        const tasks = await window.da.tasks.list("printing");
        list.innerHTML = tasks.length === 0 ? "<li>No open tasks</li>" : tasks.slice(0, 5).map((t) => "<li>#" + t.number + " " + t.title + "</li>").join("");
      } catch (_e) { list.innerHTML = "<li>Tasks unavailable</li>"; }
    } else {
      hero.innerHTML = "<p class='empty'>No printing project yet. Run <code>da seed</code>.</p>";
    }

    const rest = document.getElementById("rest");
    const byCategory = {};
    for (const p of projects) { if (p.slug === "printing") continue; (byCategory[p.category] = byCategory[p.category] || []).push(p); }
    for (const category of Object.keys(byCategory).sort()) {
      const label = document.createElement("div");
      label.className = "cat";
      label.textContent = category;
      rest.appendChild(label);
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const p of byCategory[category]) grid.appendChild(await card(p));
      rest.appendChild(grid);
    }
  })();
</script>
</body>
</html>`;

const printingHome = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>3D Printing</title>
<style>body{margin:0;background:#0b0b0f;color:#f4f4f6;font:16px/1.6 -apple-system,system-ui,sans-serif;padding:20px 16px}@media(prefers-color-scheme:light){body{background:#f6f7f9;color:#14151a}}a{color:#6ea8fe}h1{font-size:22px}li{margin:4px 0}</style></head>
<body>
<h1>3D Resin Printing</h1>
<p>The hardware track: the support-guide slicer, the Elegoo printer plugin, and the Beast Torso print run.</p>
<h2>Now</h2>
<ul>
  <li>Conforming supports: recursive-island finder and shearable tips.</li>
  <li>Elegoo printer plugin: live status, the layer on the LCD, files and health.</li>
  <li>Beast Torso: the full-size test print, after the slicer and supports are right.</li>
</ul>
<h2>Rules that bite</h2>
<ul>
  <li>File safety is absolute: verified copy plus SHA-256 before any write.</li>
  <li>Never decimate models: full detail, every layer.</li>
  <li>Every support that reaches the bottom gets a base.</li>
</ul>
<p id="repos" class="muted">Loading repos…</p>
<script>
  (async () => {
    try {
      const repos = await window.da.repos.list();
      document.getElementById("repos").textContent = repos.length + " repos registered.";
    } catch (e) { document.getElementById("repos").textContent = "Repos unavailable."; }
  })();
</script>
</body></html>`;

const md = (title: string, body: string): string => `# ${title}\n\n${body}\n`;

const SEEDS: ReadonlyArray<Seed> = [
  {
    slug: "home",
    project: { name: "Home", category: "system", description: "The owner's private site.", order: -1, pinned: true },
    pages: [{ slug: "home", kind: "html", author: "claude", content: HOME_PAGE }],
  },
  {
    slug: "printing",
    project: {
      name: "3D Printing",
      category: "hardware",
      description: "Resin printing: slicer, supports, the Elegoo plugin, the Beast Torso print.",
      order: 0,
      pinned: true,
      repos: ["~/Prints"],
    },
    pages: [{ slug: "home", kind: "html", author: "claude", content: printingHome }],
  },
  {
    slug: "support-guide",
    project: { name: "Support Guide (Slicer)", category: "hardware", description: "The resin slicer and conforming supports.", order: 1 },
    pages: [{ slug: "home", kind: "md", author: "claude", content: md("Support Guide", "The parallel, layer-independent slice kernel and the conforming-support generator. The byte bar tracks the feet mesh.") }],
  },
  {
    slug: "doubleagent-native",
    project: { name: "DoubleAgent Native", category: "platform", description: "The Expo native app: Home, sessions, plugins, Dubz.", order: 2, githubRepos: [] },
    pages: [{ slug: "home", kind: "md", author: "claude", content: md("DoubleAgent Native", "The native migration of the agent console. Native UI, Effect logic, a plugin and page system, and the bottom bar with the composer and Dubz.") }],
  },
  {
    slug: "dubz",
    project: { name: "Dubz", category: "platform", description: "The app-wide assistant window and its tool suggestions.", order: 3 },
    pages: [{ slug: "home", kind: "md", author: "claude", content: md("Dubz", "Laya reads what you type plus the screen context and suggests the tool that matches. A tap runs it with no tokens; send goes to the agent.") }],
  },
  {
    slug: "hyperlink-platform",
    project: { name: "Hyperlink Platform", category: "platform", description: "The Effect v4 + React platform the apps build on.", order: 4 },
    pages: [{ slug: "home", kind: "md", author: "claude", content: md("Hyperlink Platform", "The services, stores, dashboard and docs the apps stand on. Effect idioms throughout; Last.ts for the web and, later, native.") }],
  },
];

/** Write every seed into the store. Returns how many projects it wrote. */
export const seedProjects = (store: ProjectsStore["Service"]): Effect.Effect<number> =>
  Effect.forEach(SEEDS, (seed) =>
    store.putProject(seed.slug, seed.project).pipe(
      Effect.andThen(Effect.forEach(seed.pages, (page) => store.putPage(seed.slug, page.slug, { content: page.content, kind: page.kind, author: page.author }))),
    ),
  ).pipe(
    Effect.as(SEEDS.length),
    Effect.orDie,
  );
