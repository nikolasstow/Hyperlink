/**
 * Projects and their pages (the "Projects + Pages" prototype), as the API
 * server sends them under `/projects`.
 *
 * A **project** groups work: a name, a category, a description, and the repos
 * and GitHub repos the work lives in. A **page** belongs to a project: a
 * small document (HTML or Markdown) that an agent or a person writes — the
 * owner's "artifact". A **task** is one of a project's open GitHub issues.
 *
 * The shapes are plain on purpose: on the server each maps one-to-one onto a
 * file (`project.json`, `pages/<slug>.html`, `pages/<slug>.meta.json`), so
 * any agent can write one with no server at all.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";

/** Where projects are served. A project is `${path}/${slug}`; its pages are
 * `${path}/${slug}/pages`; its tasks are `${path}/${slug}/tasks`. */
export const path = "/projects";

/** Where a page is served as a full HTML document with the page SDK
 * (`window.da`) injected: `${viewPath}?project=<slug>&slug=<page>&env=app|browser`. */
export const viewPath = "/projects/view";

/** The repos the app registered, for a page's context. */
export const reposPath = "/projects-repos";

/** The live opencode sessions, trimmed, for a page's context. */
export const sessionsPath = "/projects-sessions";

/** How a page's body is written. `tsx` is reserved for a later React runtime. */
export const PageKind = Schema.Literals(["html", "md", "tsx"]);
export type PageKind = typeof PageKind.Type;

/** One project: the folder name is its `slug`, so the slug is the id. */
export const Project = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  /** A free label that groups projects on the home page (for example
   * "hardware", "platform"). */
  category: Schema.String,
  description: Schema.String,
  /** Repo folders this project's work lives in (absolute paths or names). */
  repos: Schema.Array(Schema.String),
  /** GitHub repos (`owner/name`) whose issues are this project's tasks. */
  githubRepos: Schema.Array(Schema.String),
  /** Sort weight on the home page. A lower number comes first. */
  order: Schema.Number,
  /** Whether the project is pinned (shown first, before order). */
  pinned: Schema.Boolean,
});
export type Project = typeof Project.Type;

/** A page's metadata (everything but its body), as listed. */
export const PageMeta = Schema.Struct({
  /** The project the page belongs to. */
  project: Schema.String,
  /** The file name (without extension) inside the project's `pages` folder. */
  slug: Schema.String,
  title: Schema.String,
  kind: PageKind,
  /** Who wrote the page last: an agent id ("claude", "cursor") or a person. */
  author: Schema.String,
  /** Epoch milliseconds. */
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type PageMeta = typeof PageMeta.Type;

/** A full page: its metadata and its body. */
export const Page = Schema.Struct({
  ...PageMeta.fields,
  content: Schema.String,
});
export type Page = typeof Page.Type;

/** A GitHub issue, trimmed to what a task list shows. */
export const Task = Schema.Struct({
  id: Schema.Number,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.String,
  url: Schema.String,
  repo: Schema.String,
});
export type Task = typeof Task.Type;

/** The fields a caller sends to make or change a project. The slug comes from
 * the route, so it is not in the body. A field left out keeps its old value. */
export const ProjectInput = Schema.Struct({
  name: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  repos: Schema.optional(Schema.Array(Schema.String)),
  githubRepos: Schema.optional(Schema.Array(Schema.String)),
  order: Schema.optional(Schema.Number),
  pinned: Schema.optional(Schema.Boolean),
});
export type ProjectInput = typeof ProjectInput.Type;

/** The fields a caller sends to write a page. `content` is required; the rest
 * fill in defaults on the server. */
export const PageInput = Schema.Struct({
  title: Schema.optional(Schema.String),
  kind: Schema.optional(PageKind),
  author: Schema.optional(Schema.String),
  content: Schema.String,
});
export type PageInput = typeof PageInput.Type;

/** One repo the app knows: its folder path, and the last path segment as a
 * short name. */
export const Repo = Schema.Struct({
  name: Schema.String,
  dir: Schema.String,
});
export type Repo = typeof Repo.Type;

/** One session, trimmed from opencode's own session shape. */
export const Session = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  updatedAt: Schema.optional(Schema.Number),
});
export type Session = typeof Session.Type;
