/**
 * The file-backed store for Projects and Pages (the prototype).
 *
 * The store reads and writes a plain tree on disk, so any agent — a
 * DoubleAgent agent, Claude Code, Cursor, or a shell script — can add a
 * project or a page with no running server, just by writing files:
 *
 *   <root>/<project-slug>/project.json
 *   <root>/<project-slug>/pages/<page-slug>.html   (or .md)
 *   <root>/<project-slug>/pages/<page-slug>.meta.json   (optional)
 *
 * `root` is `DOUBLEAGENT_PROJECTS_DIR`, else `~/.doubleagent/projects`. The
 * store reads from disk on every call, so a file another agent wrote shows up
 * at once (no watch, no cache to go stale).
 *
 * A page body file is the source of truth for its content. The sidecar
 * `<slug>.meta.json` holds the author, title and timestamps that the API
 * writes. A page a person dropped by hand has no sidecar, so the store
 * derives its title (from the HTML `<title>` or the first Markdown heading),
 * its kind (from the extension) and its timestamps (from the file).
 *
 * The shapes are `agent-console-protocol/Projects`, the wire SSOT the apps
 * decode with too.
 *
 * @internal
 */
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Page, PageInput, PageKind, PageMeta, Project, ProjectInput } from "agent-console-protocol/Projects";

/** A project or a page could not be read or written. */
export class ProjectsError extends Schema.TaggedError<ProjectsError>()("ProjectsError", {
  message: Schema.String,
}) {}

/** A project or a page the caller asked for is not there. */
export class ProjectsNotFound extends Schema.TaggedError<ProjectsNotFound>()("ProjectsNotFound", {
  message: Schema.String,
}) {}

/** A slug the caller sent is not lower-case letters, numbers and dashes. */
export class ProjectsInvalidSlug extends Schema.TaggedError<ProjectsInvalidSlug>()("ProjectsInvalidSlug", {
  message: Schema.String,
}) {}

const failed = (message: string) => (cause: unknown) =>
  new ProjectsError({
    message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
  });

const projectJson = Schema.fromJsonString(Project);
const metaJson = Schema.fromJsonString(PageMeta);

/** The store's root folder: `DOUBLEAGENT_PROJECTS_DIR`, else
 * `~/.doubleagent/projects`. */
export const projectsRoot = (join: (...parts: ReadonlyArray<string>) => string): string => {
  const override = process.env.DOUBLEAGENT_PROJECTS_DIR;
  if (override !== undefined && override.length > 0) return override;
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return join(home, ".doubleagent", "projects");
};

/** A slug is lower-case letters, numbers and dashes. The store rejects
 * anything else so a slug can never climb out of the root folder. */
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const checkSlug = (slug: string): Effect.Effect<string, ProjectsInvalidSlug> =>
  SLUG.test(slug) ? Effect.succeed(slug) : Effect.fail(new ProjectsInvalidSlug({ message: `not a valid slug: ${slug}` }));

/** The file extension for a page kind. */
const extensionOf = (kind: PageKind): string => (kind === "md" ? "md" : kind === "tsx" ? "tsx" : "html");

/** The page kind a file name carries, or undefined if it is not a page body. */
const kindOf = (fileName: string): PageKind | undefined =>
  fileName.endsWith(".meta.json") ? undefined : fileName.endsWith(".html") ? "html" : fileName.endsWith(".md") ? "md" : fileName.endsWith(".tsx") ? "tsx" : undefined;

/** The title read from a body: the HTML `<title>`, or the first Markdown
 * heading, or the slug when neither is there. */
const titleOf = (slug: string, kind: PageKind, content: string): string => {
  if (kind === "html") {
    const title = /<title>([^<]*)<\/title>/i.exec(content);
    if (title?.[1] !== undefined && title[1].trim().length > 0) return title[1].trim();
    const heading = /<h1[^>]*>([^<]*)<\/h1>/i.exec(content);
    if (heading?.[1] !== undefined && heading[1].trim().length > 0) return heading[1].trim();
  }
  if (kind === "md") {
    const match = /^#\s+(.+)$/m.exec(content);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return slug;
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = projectsRoot((...parts) => path.join(...parts));

  const projectDir = (slug: string): string => path.join(root, slug);
  const pagesDir = (slug: string): string => path.join(root, slug, "pages");

  /** The slugs of every project folder under the root, sorted. */
  const projectSlugs = fs.exists(root).pipe(
    Effect.flatMap((exists) => (exists ? fs.readDirectory(root) : Effect.succeed<ReadonlyArray<string>>([]))),
    Effect.mapError(failed(`reading ${root}`)),
    Effect.map((names) => names.filter((name) => SLUG.test(name)).slice().sort()),
  );

  const readProject = (slug: string): Effect.Effect<Project, ProjectsError | ProjectsNotFound> =>
    Effect.gen(function* () {
      const file = path.join(projectDir(slug), "project.json");
      const exists = yield* fs.exists(file).pipe(Effect.mapError(failed(`reading ${file}`)));
      if (!exists) return yield* Effect.fail(new ProjectsNotFound({ message: `no project: ${slug}` }));
      const text = yield* fs.readFileString(file).pipe(Effect.mapError(failed(`reading ${file}`)));
      return yield* Schema.decodeUnknownEffect(projectJson)(text).pipe(Effect.mapError(failed(`parsing ${file}`)));
    });

  const writeProject = (project: Project): Effect.Effect<Project, ProjectsError> =>
    fs.makeDirectory(projectDir(project.slug), { recursive: true }).pipe(
      Effect.andThen(Schema.encodeEffect(projectJson)(project)),
      Effect.flatMap((text) => fs.writeFileString(path.join(projectDir(project.slug), "project.json"), text)),
      Effect.mapError(failed(`writing project ${project.slug}`)),
      Effect.as(project),
    );

  const listProjects: Effect.Effect<ReadonlyArray<Project>, ProjectsError> = projectSlugs.pipe(
    Effect.flatMap((slugs) =>
      Effect.forEach(slugs, (slug) => readProject(slug).pipe(Effect.catchTag("ProjectsNotFound", () => Effect.succeed(undefined)))),
    ),
    Effect.map((projects) => projects.filter((project): project is Project => project !== undefined)),
    Effect.map((projects) =>
      projects.slice().sort((a, b) => (a.pinned === b.pinned ? a.order - b.order || a.name.localeCompare(b.name) : a.pinned ? -1 : 1)),
    ),
  );

  const getProject = (slug: string): Effect.Effect<Project, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* checkSlug(slug);
      return yield* readProject(slug);
    });

  /** Make a project, or change the fields a caller sent. New fields default. */
  const putProject = (slug: string, input: ProjectInput): Effect.Effect<Project, ProjectsError | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* checkSlug(slug);
      const current = yield* readProject(slug).pipe(Effect.catchTag("ProjectsNotFound", () => Effect.succeed(undefined)));
      return yield* writeProject({
        slug,
        name: input.name ?? current?.name ?? slug,
        category: input.category ?? current?.category ?? "general",
        description: input.description ?? current?.description ?? "",
        repos: input.repos ?? current?.repos ?? [],
        githubRepos: input.githubRepos ?? current?.githubRepos ?? [],
        order: input.order ?? current?.order ?? 100,
        pinned: input.pinned ?? current?.pinned ?? false,
      });
    });

  const deleteProject = (slug: string): Effect.Effect<void, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* getProject(slug);
      yield* fs.remove(projectDir(slug), { recursive: true }).pipe(Effect.mapError(failed(`removing project ${slug}`)));
    });

  /** Read a page body and its sidecar (if any) into a full page. */
  const readPage = (projectSlug: string, pageSlug: string, kind: PageKind): Effect.Effect<Page, ProjectsError> => {
    const bodyFile = path.join(pagesDir(projectSlug), `${pageSlug}.${extensionOf(kind)}`);
    const metaFile = path.join(pagesDir(projectSlug), `${pageSlug}.meta.json`);
    return Effect.all({
      content: fs.readFileString(bodyFile).pipe(Effect.mapError(failed(`reading ${bodyFile}`))),
      stat: fs.stat(bodyFile).pipe(Effect.mapError(failed(`stat ${bodyFile}`))),
      meta: fs.exists(metaFile).pipe(
        Effect.flatMap((exists) => (exists ? fs.readFileString(metaFile).pipe(Effect.flatMap(Schema.decodeUnknownEffect(metaJson))) : Effect.succeed(undefined))),
        Effect.catch(() => Effect.succeed(undefined)),
      ),
    }).pipe(
      Effect.map(({ content, stat, meta }) => {
        const born = Option.getOrUndefined(stat.birthtime)?.getTime();
        const changed = Option.getOrUndefined(stat.mtime)?.getTime();
        return {
          project: projectSlug,
          slug: pageSlug,
          title: meta?.title ?? titleOf(pageSlug, kind, content),
          kind,
          author: meta?.author ?? "unknown",
          createdAt: meta?.createdAt ?? born ?? changed ?? 0,
          updatedAt: meta?.updatedAt ?? changed ?? 0,
          content,
        };
      }),
    );
  };

  /** The page body files under a project, as `(slug, kind)` pairs. */
  const pageFiles = (projectSlug: string): Effect.Effect<ReadonlyArray<readonly [string, PageKind]>, ProjectsError> => {
    const dir = pagesDir(projectSlug);
    return fs.exists(dir).pipe(
      Effect.flatMap((exists) => (exists ? fs.readDirectory(dir) : Effect.succeed<ReadonlyArray<string>>([]))),
      Effect.mapError(failed(`reading ${dir}`)),
      Effect.map((names) =>
        names
          .map((name) => {
            const kind = kindOf(name);
            if (kind === undefined) return undefined;
            const slug = name.slice(0, name.length - extensionOf(kind).length - 1);
            return SLUG.test(slug) ? ([slug, kind] as const) : undefined;
          })
          .filter((pair): pair is readonly [string, PageKind] => pair !== undefined),
      ),
    );
  };

  const listPages = (projectSlug: string): Effect.Effect<ReadonlyArray<PageMeta>, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* getProject(projectSlug);
      const pairs = yield* pageFiles(projectSlug);
      const pages = yield* Effect.forEach(pairs, ([slug, kind]) => readPage(projectSlug, slug, kind));
      return pages.map(({ content: _content, ...meta }) => meta).slice().sort((a, b) => a.slug.localeCompare(b.slug));
    });

  const getPage = (projectSlug: string, pageSlug: string): Effect.Effect<Page, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* checkSlug(projectSlug);
      yield* checkSlug(pageSlug);
      const pairs = yield* pageFiles(projectSlug);
      const found = pairs.find(([slug]) => slug === pageSlug);
      if (found === undefined) return yield* Effect.fail(new ProjectsNotFound({ message: `no page: ${projectSlug}/${pageSlug}` }));
      return yield* readPage(projectSlug, pageSlug, found[1]);
    });

  /** Write a page body and its sidecar. The project must exist. */
  const putPage = (projectSlug: string, pageSlug: string, input: PageInput): Effect.Effect<Page, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      yield* checkSlug(projectSlug);
      yield* checkSlug(pageSlug);
      yield* getProject(projectSlug);
      const pairs = yield* pageFiles(projectSlug);
      const existing = pairs.find(([slug]) => slug === pageSlug);
      const now = Date.now();
      const kind: PageKind = input.kind ?? existing?.[1] ?? "html";
      const dir = pagesDir(projectSlug);
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(failed(`making ${dir}`)));
      // A kind change leaves the old body behind; remove it first.
      if (existing !== undefined && existing[1] !== kind) {
        yield* fs.remove(path.join(dir, `${pageSlug}.${extensionOf(existing[1])}`)).pipe(Effect.mapError(failed(`removing old body ${pageSlug}`)));
      }
      const prior = existing === undefined ? undefined : yield* readPage(projectSlug, pageSlug, existing[1]).pipe(Effect.catch(() => Effect.succeed(undefined)));
      const meta: PageMeta = {
        project: projectSlug,
        slug: pageSlug,
        title: input.title ?? prior?.title ?? titleOf(pageSlug, kind, input.content),
        kind,
        author: input.author ?? prior?.author ?? "unknown",
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      yield* fs.writeFileString(path.join(dir, `${pageSlug}.${extensionOf(kind)}`), input.content).pipe(Effect.mapError(failed(`writing page ${pageSlug}`)));
      yield* Schema.encodeEffect(metaJson)(meta).pipe(
        Effect.flatMap((text) => fs.writeFileString(path.join(dir, `${pageSlug}.meta.json`), text)),
        Effect.mapError(failed(`writing meta ${pageSlug}`)),
      );
      return { ...meta, content: input.content };
    });

  const deletePage = (projectSlug: string, pageSlug: string): Effect.Effect<void, ProjectsError | ProjectsNotFound | ProjectsInvalidSlug> =>
    Effect.gen(function* () {
      const page = yield* getPage(projectSlug, pageSlug);
      const dir = pagesDir(projectSlug);
      yield* fs.remove(path.join(dir, `${pageSlug}.${extensionOf(page.kind)}`)).pipe(Effect.mapError(failed(`removing page ${pageSlug}`)));
      yield* fs.remove(path.join(dir, `${pageSlug}.meta.json`)).pipe(Effect.catch(() => Effect.void));
    });

  return {
    root,
    listProjects,
    getProject,
    putProject,
    deleteProject,
    listPages,
    getPage,
    putPage,
    deletePage,
  };
});

export class ProjectsStore extends Context.Service<ProjectsStore, Effect.Success<typeof make>>()("agent-console/ProjectsStore") {
  static readonly layer = Layer.effect(ProjectsStore, make).pipe(Layer.provide(NodeServices.layer));
}
