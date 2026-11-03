import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { describe, expect, it } from "vitest";
import { Page, PageInput, Project, ProjectInput } from "./model";
import { renderPage } from "./render";
import { DA_SDK_JS } from "./sdk";
import { ProjectsStore } from "./store";
import { tasksOf } from "./tasks";

/** Run an effect against a fresh store rooted at a temp folder. The store
 * reads `DOUBLEAGENT_PROJECTS_DIR`, so each test gets its own tree. The effect
 * may also use the FileSystem (to drop a file by hand) and the HttpClient. */
const withStore = <A, E>(use: (store: ProjectsStore["Service"]) => Effect.Effect<A, E, FileSystem.FileSystem | HttpClient.HttpClient>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      process.env.DOUBLEAGENT_PROJECTS_DIR = dir;
      const result = yield* Effect.gen(function* () {
        const store = yield* ProjectsStore;
        return yield* use(store);
      }).pipe(Effect.provide(Layer.fresh(ProjectsStore.layer)));
      delete process.env.DOUBLEAGENT_PROJECTS_DIR;
      return result;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.provide(FetchHttpClient.layer)),
  );

describe("projects schemas", () => {
  it("round-trips a project through JSON", () => {
    const project: Project = {
      slug: "printing",
      name: "3D Printing",
      category: "hardware",
      description: "resin",
      repos: ["/Users/x/prints"],
      githubRepos: ["owner/repo"],
      order: 0,
      pinned: true,
    };
    const text = Schema.encodeUnknownSync(Schema.fromJsonString(Project))(project);
    expect(Schema.decodeUnknownSync(Schema.fromJsonString(Project))(text)).toEqual(project);
  });

  it("defaults a page kind to html and requires content", () => {
    const input: PageInput = { content: "<h1>hi</h1>" };
    expect(input.kind).toBeUndefined();
    expect(Schema.is(PageInput)(input)).toBe(true);
  });
});

describe("projects store", () => {
  it("creates, reads, updates and lists projects, pinned first", async () => {
    const result = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.putProject("alpha", { name: "Alpha", category: "platform", order: 2 } satisfies ProjectInput);
        yield* store.putProject("beta", { name: "Beta", category: "hardware", order: 1, pinned: true } satisfies ProjectInput);
        // A second put only changes the fields sent; the rest stay.
        yield* store.putProject("alpha", { description: "changed" });
        const alpha = yield* store.getProject("alpha");
        const list = yield* store.listProjects;
        return { alpha, order: list.map((p) => p.slug) };
      }),
    );
    expect(result.alpha.name).toBe("Alpha");
    expect(result.alpha.description).toBe("changed");
    // Beta is pinned, so it comes first.
    expect(result.order).toEqual(["beta", "alpha"]);
  });

  it("writes a page and reads it back with its author", async () => {
    const page = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.putProject("printing", { name: "Printing", category: "hardware" });
        yield* store.putPage("printing", "home", { content: "<h1>Prints</h1>", author: "claude", kind: "html" } satisfies PageInput);
        return yield* store.getPage("printing", "home");
      }),
    );
    expect(page.author).toBe("claude");
    expect(page.kind).toBe("html");
    expect(page.title).toBe("Prints");
    expect(page.content).toContain("Prints");
  });

  it("reads a page a person dropped by hand, with a derived title", async () => {
    const page = await withStore((store) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* store.putProject("notes", { name: "Notes", category: "general" });
        const dir = `${store.root}/notes/pages`;
        yield* fs.makeDirectory(dir, { recursive: true });
        yield* fs.writeFileString(`${dir}/idea.md`, "# A Big Idea\n\nbody");
        return yield* store.getPage("notes", "idea");
      }),
    );
    expect(page.kind).toBe("md");
    expect(page.title).toBe("A Big Idea");
    expect(page.author).toBe("unknown");
  });

  it("rejects a bad slug", async () => {
    const failed = await withStore((store) => store.getProject("../escape").pipe(Effect.flip));
    expect(failed._tag).toBe("ProjectsInvalidSlug");
  });

  it("fails with ProjectsNotFound for a missing project", async () => {
    const failed = await withStore((store) => store.getProject("ghost").pipe(Effect.flip));
    expect(failed._tag).toBe("ProjectsNotFound");
  });

  it("deletes a page", async () => {
    const after = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.putProject("p", { name: "P", category: "general" });
        yield* store.putPage("p", "one", { content: "<p>1</p>" });
        yield* store.deletePage("p", "one");
        return yield* store.listPages("p");
      }),
    );
    expect(after).toEqual([]);
  });
});

describe("tasks", () => {
  it("returns no tasks when a project has no GitHub repos", async () => {
    const tasks = await withStore((store) =>
      Effect.gen(function* () {
        yield* store.putProject("solo", { name: "Solo", category: "general" });
        const project = yield* store.getProject("solo");
        // No githubRepos, so no HTTP call runs; the result is empty.
        return yield* tasksOf(project);
      }),
    );
    expect(tasks).toEqual([]);
  });
});

describe("render", () => {
  const page: Page = {
    project: "printing",
    slug: "home",
    title: "Home",
    kind: "html",
    author: "claude",
    createdAt: 0,
    updatedAt: 0,
    content: "<!doctype html><html><head><title>Home</title></head><body><h1>Hi</h1></body></html>",
  };

  it("injects the SDK into an HTML page, before </head>", () => {
    const html = renderPage(page, { env: "app" });
    expect(html).toContain("window.da");
    expect(html).toContain('"env":"app"');
    // No apiBase seeded: the SDK derives it from its own URL.
    expect(html).not.toContain("apiBase\":");
    // The SDK goes in before the author's head closes, so it loads first.
    expect(html.indexOf("window.da")).toBeLessThan(html.indexOf("</head>"));
  });

  it("wraps a Markdown page and carries the SDK and the source", () => {
    const html = renderPage({ ...page, kind: "md", content: "# Title\n\ntext" }, { env: "browser", apiBase: "/da" });
    expect(html).toContain('"apiBase":"/da"');
    expect(html).toContain("marked");
    expect(html).toContain("window.da");
    expect(html).toContain("# Title");
  });
});

describe("page SDK", () => {
  /** What the tests read off `window.da`. The SDK is a plain script, so the
   * test runs it against a fake `window` and decodes what it defined. */
  const Sdk = Schema.Struct({
    env: Schema.Literals(["app", "browser"]),
    apiBase: Schema.String,
    link: Schema.Struct({
      page: Schema.Unknown,
    }),
    projects: Schema.Struct({
      list: Schema.Unknown,
    }),
  });

  const call = (fn: unknown, ...args: ReadonlyArray<unknown>): unknown => (typeof fn === "function" ? fn(...args) : undefined);

  /** Run the SDK with `window.__DA__ = seed` at `pathname`. Returns the
   * decoded `window.da` and the URLs its `fetch` asked for. */
  const runSdk = (seed: Record<string, unknown>, pathname: string) => {
    const fetched: Array<string> = [];
    const fetch = (url: string) => {
      fetched.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    };
    const window: Record<string, unknown> = {
      __DA__: seed,
      location: { pathname },
    };
    const document = { addEventListener: () => undefined };
    // The SDK reads `window`, `document` and `fetch` as globals; bind them.
    new Function("window", "document", "fetch", DA_SDK_JS)(window, document, fetch);
    return { da: Schema.decodeUnknownSync(Sdk)(window.da), fetched };
  };

  it("takes the API root from its own URL when none is seeded", async () => {
    const { da, fetched } = runSdk({ env: "browser", project: "p", slug: "s" }, "/da/projects/view");
    expect(da.apiBase).toBe("/da");
    await call(da.projects.list);
    expect(fetched).toEqual(["/da/projects"]);
    expect(call(da.link.page, "p", "s")).toBe("/da/projects/view?project=p&slug=s");
  });

  it("keeps a seeded apiBase", async () => {
    const { da, fetched } = runSdk({ env: "browser", apiBase: "http://mac:5199" }, "/anything");
    expect(da.apiBase).toBe("http://mac:5199");
    await call(da.projects.list);
    expect(fetched).toEqual(["http://mac:5199/projects"]);
  });

  it("is at the origin root when served unproxied, and links natively in the app", () => {
    const { da } = runSdk({ env: "app" }, "/projects/view");
    expect(da.apiBase).toBe("");
    expect(da.env).toBe("app");
    expect(call(da.link.page, "p", "s")).toBe("da:page:p:s");
  });
});
