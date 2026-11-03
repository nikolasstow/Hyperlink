---
"agent-console": patch
"agent-console-protocol": patch
"agent-console-native": patch
---

Projects + Pages prototype. A **project** is a folder under `~/.doubleagent/projects` (`DOUBLEAGENT_PROJECTS_DIR`) with a `project.json`; a **page** (the owner's artifact) is an HTML or Markdown file under its `pages/` folder, with an optional `.meta.json` sidecar. Any agent can write the tree with no server running.

- **Wire shapes** — `agent-console-protocol/Projects`: `Project`, `PageMeta`, `Page`, `Task`, `ProjectInput`, `PageInput`, `Repo`, `Session`, and the paths.
- **Server** (`packages/agent-console`, `pnpm serve`) — `ProjectsStore` (an Effect service over `FileSystem`), the `projects` HttpApi group (`/projects`, `/projects/:slug`, `/projects/:slug/pages/:page`, `/projects/:slug/tasks`, `/projects-repos`, `/projects-sessions`), and `GET /projects/view?project=&slug=&env=` that renders a page as a full document with the page SDK injected. A bad slug is 400, a missing project or page is 404.
- **Page SDK** — `window.da`: `projects.list()`, `pages.list(project)`, `pages.get(project, slug)`, `tasks.list(project)`, `repos.list()`, `sessions.list()`, `link.page/session/file`, `open`, `chrome.set`, `context.set`. It finds its API root from the URL it was served at, or from a seeded `window.__DA__.apiBase`.
- **CLI** — `pnpm -F agent-console da {projects,pages,tasks,repos,sessions,seed}`. Talks to the API (`DA_API`, `DA_TOKEN` or the admin token); falls back to the file store when the server does not answer.
- **Web app** — `/projects` lists the projects and their pages, over a `/da` dev-server proxy to the API; a Projects button on Home.
- **Native app** — Projects in Home's menu; a page opens in a WebView with `window.__DA__` seeded (server URL and token). Not yet verified on a device.
