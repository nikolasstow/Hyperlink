/**
 * `da` — the Projects + Pages CLI. Any agent (Claude Code, Cursor, a shell
 * script) makes a project or writes a page with one command. The owner wants
 * the feature open to agents of any source, so this CLI needs nothing but the
 * repo checkout.
 *
 * It talks to the running API server by default (so it sees live repos,
 * sessions and tasks). When the server cannot be reached, it falls back to the
 * same file store the server reads (projects/store.ts), so projects and pages
 * still work offline — an agent on the Mac writes files directly.
 *
 *   pnpm --filter agent-console da projects list
 *   pnpm --filter agent-console da projects add printing --name "3D Printing" --category hardware
 *   pnpm --filter agent-console da pages put printing/home ./home.html --author claude
 *   pnpm --filter agent-console da pages get printing/home
 *   pnpm --filter agent-console da tasks printing
 *   pnpm --filter agent-console da seed
 *
 * The server base is `DA_API` (default `http://127.0.0.1:5199`). The token is
 * `DA_TOKEN`, else the admin token in the server's state folder.
 *
 * @internal
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Data, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import { adminTokenFile, stateDirectory } from "../server/sessions/files";
import { Page, PageMeta, Project, Repo, Session, Task } from "agent-console-protocol/Projects";
import { ProjectsStore } from "../server/projects/store";
import { seedProjects } from "../server/projects/seed";

/** A failure the person at the shell can act on, printed as one line. */
class DaError extends Data.TaggedError("DaError")<{
  readonly message: string;
}> {}

const apiBase = (): string => process.env.DA_API ?? "http://127.0.0.1:5199";

/** The token to send: `DA_TOKEN`, else the admin token on disk, else none. */
const token: Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> = Effect.gen(function* () {
  const fromEnv = process.env.DA_TOKEN;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(
    stateDirectory((...parts) => path.join(...parts)),
    adminTokenFile,
  );
  return yield* fs.readFileString(file).pipe(
    Effect.map((text) => text.trim()),
    Effect.catch(() => Effect.succeed(undefined)),
  );
});

/** Everything the HTTP helpers need; all provided at the program root. */
type ApiCtx = HttpClient.HttpClient | FileSystem.FileSystem | Path.Path;

/** What a call to the API can fail with. */
type ApiError = HttpClientError.HttpClientError | HttpBody.HttpBodyError | Schema.SchemaError;

/** The error body the server sends with a non-2xx status. */
const ErrorBody = Schema.Struct({
  message: Schema.String,
});

const withBearer = (bearer: string | undefined) => (request: HttpClientRequest.HttpClientRequest) =>
  bearer === undefined ? request : HttpClientRequest.bearerToken(request, bearer);

/** Send `request` and decode the JSON body with `schemaOf`. */
const execute = <S extends Schema.Top>(
  schemaOf: S,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<S["Type"], ApiError, HttpClient.HttpClient | S["DecodingServices"]> =>
  HttpClient.HttpClient.pipe(
    Effect.flatMap((client) => client.execute(request)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schemaOf)),
  );

/** A GET against the API, decoded with `schemaOf`. */
const apiGet = <S extends Schema.Top>(schemaOf: S, suffix: string): Effect.Effect<S["Type"], ApiError, ApiCtx | S["DecodingServices"]> =>
  token.pipe(
    Effect.map((bearer) =>
      HttpClientRequest.get(`${apiBase()}${suffix}`).pipe(
        withBearer(bearer),
      ),
    ),
    Effect.flatMap((request) => execute(schemaOf, request)),
  );

/** A write (POST/PUT/DELETE) against the API, decoded with `schemaOf`. */
const apiSend = <S extends Schema.Top>(
  method: "POST" | "PUT" | "DELETE",
  schemaOf: S,
  suffix: string,
  body?: unknown,
): Effect.Effect<S["Type"], ApiError, ApiCtx | S["DecodingServices"]> =>
  token.pipe(
    Effect.map((bearer) =>
      HttpClientRequest.make(method)(`${apiBase()}${suffix}`).pipe(
        withBearer(bearer),
      ),
    ),
    Effect.flatMap((request) => (body === undefined ? Effect.succeed(request) : HttpClientRequest.bodyJson(request, body))),
    Effect.flatMap((request) => execute(schemaOf, request)),
  );

/** The server's own message for a non-2xx status, else the status code. */
const statusMessage = (reason: HttpClientError.StatusCodeError): Effect.Effect<DaError> =>
  HttpClientResponse.schemaBodyJson(ErrorBody)(reason.response).pipe(
    Effect.map((body) => new DaError({ message: body.message })),
    Effect.catch(() => Effect.succeed(new DaError({ message: `${reason.response.status} from ${reason.request.method} ${reason.request.url}` }))),
  );

/** The server did not answer at all (down, wrong port). Distinct from a
 * `DaError` so a caller can choose a fallback. */
class Unreachable extends Data.TaggedError("Unreachable") {}

/** Sort an API failure: no answer is `Unreachable`; a real error (a 404, a
 * bad slug, a body that did not decode) is a one-line `DaError`. */
const fromApi = <A, R>(online: Effect.Effect<A, ApiError, R>): Effect.Effect<A, DaError | Unreachable, R> =>
  online.pipe(
    Effect.catchReason("HttpClientError", "TransportError", () => Effect.fail(new Unreachable())),
    Effect.catchReason("HttpClientError", "StatusCodeError", (reason) =>
      statusMessage(reason).pipe(
        Effect.flatMap(Effect.fail),
      ),
    ),
    Effect.catchTag("HttpClientError", (error) => Effect.fail(new DaError({ message: error.message }))),
    Effect.catchTag("HttpBodyError", (error) => Effect.fail(new DaError({ message: `encoding the request: ${error.message}` }))),
    Effect.catchTag("SchemaError", (error) => Effect.fail(new DaError({ message: `the server's answer did not decode: ${error.message}` }))),
  );

/** Try `online` (the API); if the server cannot be reached, run `offline`
 * (the local file store). A real error is not retried. */
const orLocal = <A, E, R>(online: Effect.Effect<A, ApiError, ApiCtx>, offline: Effect.Effect<A, E, R>): Effect.Effect<A, E | DaError, ApiCtx | R> =>
  fromApi(online).pipe(
    Effect.catchTag("Unreachable", () =>
      Console.error("[da] server unreachable; using the local file store").pipe(
        Effect.andThen(offline),
      ),
    ),
  );

/** The API only (no file-store fallback): for live context the store does not
 * have. */
const serverOnly = <A>(online: Effect.Effect<A, ApiError, ApiCtx>): Effect.Effect<A, DaError, ApiCtx> =>
  fromApi(online).pipe(
    Effect.catchTag("Unreachable", () => Effect.fail(new DaError({ message: `the server at ${apiBase()} cannot be reached` }))),
  );

const splitRef = (ref: string): Effect.Effect<readonly [string, string], DaError> => {
  const [project, slug, ...rest] = ref.split("/");
  return project === undefined || project.length === 0 || slug === undefined || slug.length === 0 || rest.length > 0
    ? Effect.fail(new DaError({ message: `expected <project>/<page>, got: ${ref}` }))
    : Effect.succeed([project, slug]);
};

/** Comma-separated flag text to a list, or undefined when empty. */
const commas = (value: string): ReadonlyArray<string> | undefined => {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
};

const lines = (rows: ReadonlyArray<string>): string => (rows.length === 0 ? "(none)" : rows.join("\n"));

// ---- projects ----

const projectsList = Command.make("list").pipe(
  Command.withDescription("List every project."),
  Command.withHandler(() =>
    orLocal(
      apiGet(Schema.Array(Project), "/projects"),
      ProjectsStore.pipe(Effect.flatMap((s) => s.listProjects)),
    ).pipe(
      Effect.map((projects) => projects.map((p) => `${p.pinned ? "*" : " "} ${p.slug.padEnd(20)} ${p.category.padEnd(12)} ${p.name}`)),
      Effect.flatMap((rows) => Console.log(lines(rows))),
    ),
  ),
);

const projectsAdd = Command.make("add", {
  slug: Argument.String("slug"),
  name: Flag.String("name").pipe(Flag.optional),
  category: Flag.String("category").pipe(Flag.optional),
  description: Flag.String("description").pipe(Flag.optional),
  order: Flag.Int("order").pipe(Flag.optional),
  pinned: Flag.Boolean("pinned"),
  repos: Flag.String("repos").pipe(Flag.withDefault("")),
  github: Flag.String("github").pipe(Flag.withDefault("")),
}).pipe(
  Command.withDescription("Make a project, or change the fields you pass. --repos and --github are comma-separated."),
  Command.withHandler((args) => {
    const input = {
      name: Option.getOrUndefined(args.name),
      category: Option.getOrUndefined(args.category),
      description: Option.getOrUndefined(args.description),
      order: Option.getOrUndefined(args.order),
      pinned: args.pinned ? true : undefined,
      repos: commas(args.repos),
      githubRepos: commas(args.github),
    };
    return orLocal(
      apiSend("POST", Project, `/projects/${args.slug}`, input),
      ProjectsStore.pipe(Effect.flatMap((s) => s.putProject(args.slug, input))),
    ).pipe(
      Effect.flatMap((project) => Console.log(`project ${project.slug} saved (${project.category})`)),
    );
  }),
);

const projectsRm = Command.make("rm", {
  slug: Argument.String("slug"),
}).pipe(
  Command.withDescription("Remove a project and its pages."),
  Command.withHandler((args) =>
    orLocal(
      apiSend("DELETE", Schema.Struct({ ok: Schema.Boolean }), `/projects/${args.slug}`),
      ProjectsStore.pipe(
        Effect.flatMap((s) => s.deleteProject(args.slug)),
        Effect.as({ ok: true }),
      ),
    ).pipe(
      Effect.flatMap(() => Console.log(`project ${args.slug} removed`)),
    ),
  ),
);

const projects = Command.make("projects").pipe(
  Command.withDescription("Projects."),
  Command.withSubcommands([projectsList, projectsAdd, projectsRm]),
);

// ---- pages ----

const pagesList = Command.make("list", {
  project: Argument.String("project"),
}).pipe(
  Command.withDescription("List a project's pages."),
  Command.withHandler((args) =>
    orLocal(
      apiGet(Schema.Array(PageMeta), `/projects/${args.project}/pages`),
      ProjectsStore.pipe(Effect.flatMap((s) => s.listPages(args.project))),
    ).pipe(
      Effect.map((pages) => pages.map((p) => `${p.slug.padEnd(20)} ${p.kind.padEnd(5)} ${p.author.padEnd(10)} ${p.title}`)),
      Effect.flatMap((rows) => Console.log(lines(rows))),
    ),
  ),
);

const pagesGet = Command.make("get", {
  ref: Argument.String("project/page"),
}).pipe(
  Command.withDescription("Print a page's body."),
  Command.withHandler((args) =>
    splitRef(args.ref).pipe(
      Effect.flatMap(([project, slug]) =>
        orLocal(
          apiGet(Page, `/projects/${project}/pages/${slug}`),
          ProjectsStore.pipe(Effect.flatMap((s) => s.getPage(project, slug))),
        ),
      ),
      Effect.flatMap((page) => Console.log(page.content)),
    ),
  ),
);

const kindOfFile = (file: string): "html" | "md" | "tsx" => (file.endsWith(".md") ? "md" : file.endsWith(".tsx") ? "tsx" : "html");

const pagesPut = Command.make("put", {
  ref: Argument.String("project/page"),
  file: Argument.String("file"),
  author: Flag.String("author").pipe(Flag.withDefault("cli")),
  title: Flag.String("title").pipe(Flag.optional),
  kind: Flag.Literals("kind", ["html", "md", "tsx"]).pipe(Flag.optional),
}).pipe(
  Command.withDescription("Write a page from a file."),
  Command.withHandler((args) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const [project, slug] = yield* splitRef(args.ref);
      const content = yield* fs.readFileString(args.file).pipe(
        Effect.mapError((error) => new DaError({ message: `reading ${args.file}: ${error.message}` })),
      );
      const input = {
        content,
        author: args.author,
        kind: Option.getOrElse(args.kind, () => kindOfFile(args.file)),
        title: Option.getOrUndefined(args.title),
      };
      const page = yield* orLocal(
        apiSend("PUT", Page, `/projects/${project}/pages/${slug}`, input),
        ProjectsStore.pipe(Effect.flatMap((s) => s.putPage(project, slug, input))),
      );
      yield* Console.log(`page ${page.project}/${page.slug} saved (${page.kind})`);
    }),
  ),
);

const pagesRm = Command.make("rm", {
  ref: Argument.String("project/page"),
}).pipe(
  Command.withDescription("Remove a page."),
  Command.withHandler((args) =>
    splitRef(args.ref).pipe(
      Effect.flatMap(([project, slug]) =>
        orLocal(
          apiSend("DELETE", Schema.Struct({ ok: Schema.Boolean }), `/projects/${project}/pages/${slug}`),
          ProjectsStore.pipe(
            Effect.flatMap((s) => s.deletePage(project, slug)),
            Effect.as({ ok: true }),
          ),
        ).pipe(
          Effect.flatMap(() => Console.log(`page ${project}/${slug} removed`)),
        ),
      ),
    ),
  ),
);

const pages = Command.make("pages").pipe(
  Command.withDescription("Pages (artifacts)."),
  Command.withSubcommands([pagesList, pagesGet, pagesPut, pagesRm]),
);

// ---- live context (server only) ----

const tasks = Command.make("tasks", {
  project: Argument.String("project"),
}).pipe(
  Command.withDescription("A project's open GitHub issues (needs the server)."),
  Command.withHandler((args) =>
    serverOnly(apiGet(Schema.Array(Task), `/projects/${args.project}/tasks`)).pipe(
      Effect.map((list) => list.map((t) => `#${t.number} [${t.repo}] ${t.title}`)),
      Effect.flatMap((rows) => Console.log(lines(rows))),
    ),
  ),
);

const repos = Command.make("repos").pipe(
  Command.withDescription("The repos the app registered (needs the server)."),
  Command.withHandler(() =>
    serverOnly(apiGet(Schema.Array(Repo), "/projects-repos")).pipe(
      Effect.map((list) => list.map((r) => `${r.name.padEnd(24)} ${r.dir}`)),
      Effect.flatMap((rows) => Console.log(lines(rows))),
    ),
  ),
);

const sessions = Command.make("sessions").pipe(
  Command.withDescription("The live sessions (needs the server and opencode)."),
  Command.withHandler(() =>
    serverOnly(apiGet(Schema.Array(Session), "/projects-sessions")).pipe(
      Effect.map((list) => list.map((s) => `${s.id.padEnd(28)} ${s.title}`)),
      Effect.flatMap((rows) => Console.log(lines(rows))),
    ),
  ),
);

// ---- seed ----

const seed = Command.make("seed").pipe(
  Command.withDescription("Write the demo projects and pages to the local store."),
  Command.withHandler(() =>
    ProjectsStore.pipe(
      Effect.flatMap(seedProjects),
      Effect.flatMap((count) => Console.log(`seeded ${count} projects into the local store`)),
    ),
  ),
);

const da = Command.make("da").pipe(
  Command.withDescription("DoubleAgent Projects + Pages."),
  Command.withSubcommands([projects, pages, tasks, repos, sessions, seed]),
);

/** One line on stderr for a failure the person can act on. `Command.run`
 * renders its own parse errors and help, so those pass through silent. */
const report = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  program.pipe(
    Effect.tapError((error) =>
      CliError.isCliError(error) || !(error instanceof Error)
        ? Effect.void
        : Console.error(`[da] ${error.message}`),
    ),
  );

const program = Command.run(da, { version: "0.1.0" }).pipe(
  report,
  Effect.provide(FetchHttpClient.layer),
  Effect.provide(ProjectsStore.layer),
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
