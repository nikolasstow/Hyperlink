/**
 * Projects — the owner's ongoing work as a list, each project with its pages
 * (artifacts) under it. A tap on a page opens it as the server renders it
 * (`/da/projects/view`, with `window.da` injected), so the page is the same
 * document the native app shows.
 *
 * Data comes from the API server through the dev server's `/da` proxy
 * (vite.config.ts), decoded with the same schemas the server encodes with.
 *
 * @internal
 */
import { ChevronLeft, FileText, Pin } from "lucide-react";
import * as React from "react";
import { Schema } from "effect";
import * as Router from "last-ts/Router";
import { PageMeta, Project } from "../server/projects/model";
import { urls } from "../site";
import { navigateWithTransition } from "../viewTransition";

/** Where the API server is reached from this page. */
const API = "/da";

const decodeProjects = Schema.decodeUnknownPromise(Schema.Array(Project));
const decodePages = Schema.decodeUnknownPromise(Schema.Array(PageMeta));

const getJson = async (path: string): Promise<unknown> => {
  const response = await fetch(`${API}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
};

/** The URL of a page as the server renders it. */
export const pageViewUrl = (project: string, slug: string): string =>
  `${API}/projects/view?project=${encodeURIComponent(project)}&slug=${encodeURIComponent(slug)}`;

type Loaded = {
  readonly projects: ReadonlyArray<Project>;
  readonly pages: ReadonlyMap<string, ReadonlyArray<PageMeta>>;
};

const load = async (): Promise<Loaded> => {
  const projects = await getJson("/projects").then(decodeProjects);
  const lists = await Promise.all(
    projects.map((project) =>
      getJson(`/projects/${encodeURIComponent(project.slug)}/pages`)
        .then(decodePages)
        .catch((): ReadonlyArray<PageMeta> => []),
    ),
  );
  return {
    projects,
    pages: new Map(projects.map((project, index) => [project.slug, lists[index] ?? []])),
  };
};

/** Projects grouped by category, in the order the server sorted them
 * (pinned first, then `order`, then name). */
const byCategory = (projects: ReadonlyArray<Project>): ReadonlyArray<readonly [string, ReadonlyArray<Project>]> => {
  const groups = new Map<string, Array<Project>>();
  for (const project of projects) {
    const group = groups.get(project.category) ?? [];
    group.push(project);
    groups.set(project.category, group);
  }
  return [...groups.entries()];
};

export const Projects = (): React.ReactElement => {
  const router = Router.useRouter();
  const [loaded, setLoaded] = React.useState<Loaded | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const refresh = React.useCallback((): void => {
    setError(undefined);
    load()
      .then(setLoaded)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load the projects."));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const goBack = (): void => {
    navigateWithTransition(() => router.go(urls.sessions()));
  };

  return (
    <div className="settings-page">
      <header className="chat-header">
        <button type="button" className="back-link" aria-label="Back" onClick={goBack}>
          <ChevronLeft size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <span className="chat-title">Projects</span>
      </header>

      {error !== undefined ? (
        <div className="error-banner">
          {error}{" "}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </div>
      ) : null}

      {loaded === undefined && error === undefined ? <p className="hint">Loading…</p> : null}

      {loaded !== undefined && loaded.projects.length === 0 ? (
        <p className="hint">
          No projects yet. Make one with <code>pnpm -F agent-console da projects add &lt;slug&gt; --name …</code>
        </p>
      ) : null}

      {loaded !== undefined
        ? byCategory(loaded.projects).map(([category, projects]) => (
            <section key={category} className="repo-list-section">
              <h2 className="section-heading">{category}</h2>
              <div className="project-list">
                {projects.map((project) => {
                  const pages = loaded.pages.get(project.slug) ?? [];
                  return (
                    <article key={project.slug} className="project-card">
                      <div className="project-card-head">
                        <h3 className="project-card-name">
                          {project.pinned ? <Pin size={14} strokeWidth={1.8} aria-label="Pinned" className="project-card-pin" /> : null}
                          {project.name}
                        </h3>
                        <span className="project-card-slug">{project.slug}</span>
                      </div>
                      {project.description.length > 0 ? <p className="project-card-description">{project.description}</p> : null}
                      {pages.length === 0 ? (
                        <p className="project-card-empty">No pages yet.</p>
                      ) : (
                        <ul className="project-pages">
                          {pages.map((page) => (
                            <li key={page.slug}>
                              <a className="project-page-link" href={pageViewUrl(project.slug, page.slug)}>
                                <FileText size={16} strokeWidth={1.7} aria-hidden="true" />
                                <span className="project-page-title">{page.title}</span>
                                <span className="project-page-meta">
                                  {page.kind} · {page.author}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        : null}
    </div>
  );
};
