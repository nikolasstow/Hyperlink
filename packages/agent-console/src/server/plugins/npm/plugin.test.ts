import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "vitest";
import type { PluginBlock, PluginCollectionContent, PluginItem } from "../../plugin/api";
import plugin from "./plugin";

/** A monorepo in a temp folder: the lockfile at the root, the package the
 * workspace points at one level down, and folders the search must skip. */
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  const app = path.join(root, "packages", "app");
  yield* fs.makeDirectory(path.join(app, "tools"), { recursive: true });
  yield* fs.makeDirectory(path.join(app, "node_modules", "dep"), { recursive: true });
  yield* fs.makeDirectory(path.join(app, ".cache"), { recursive: true });
  yield* fs.writeFileString(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  yield* fs.writeFileString(
    path.join(app, "package.json"),
    [
      "{",
      '  "name": "app",',
      '  "version": "1.2.3",',
      '  "description": "The app",',
      '  "packageManager": "pnpm@10.33.4+sha512.abc",',
      '  "scripts": {',
      '    "build": "tsc -b",',
      '    "test": "vitest run",',
      '    "prebuild": "rimraf dist"',
      "  },",
      '  "devDependencies": {',
      '    "vitest": "^3.0.0"',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  yield* fs.writeFileString(path.join(app, "tools", "package.json"), '{ "name": "tools", "packageManager": "yarn@4.1.0", "scripts": { "gen": "node gen.js" } }');
  yield* fs.writeFileString(path.join(app, "node_modules", "dep", "package.json"), '{ "name": "dep", "scripts": { "x": "y" } }');
  yield* fs.writeFileString(path.join(app, ".cache", "package.json"), '{ "name": "cached" }');
  return app;
});

const scriptsFor = (workspace: string) => {
  const collection = plugin.collections?.["scripts"];
  if (collection === undefined) throw new Error("the scripts collection is missing");
  return collection.content({ workspace, params: {} });
};

const pageFor =
  (id: string, params: Readonly<Record<string, string>> = {}) =>
  (workspace: string) => {
    const page = plugin.sectionPages?.[id];
    if (page === undefined) throw new Error(`the ${id} page is missing`);
    return page.content({ workspace, params });
  };

const packagesFor = (workspace: string) => {
  const collection = plugin.collections?.["packages"];
  if (collection === undefined) throw new Error("the packages collection is missing");
  return collection.content({ workspace, params: {} });
};

const searchFor = (workspace: string, query: string) => {
  const search = plugin.collections?.["packages"]?.search;
  if (search === undefined) throw new Error("the packages collection has no search");
  return search.run({ workspace, params: {} }, query);
};

const describeParams = (params: Readonly<Record<string, string>> | undefined) =>
  params === undefined || Object.keys(params).length === 0
    ? ""
    : `(${Object.entries(params)
        .map(([key, value]) => `${key}=${value}`)
        .join(",")})`;

/** A page's blocks as text, to compare whole. */
const describeBlocks = (blocks: ReadonlyArray<PluginBlock>) =>
  blocks.map((block) => {
    switch (block._tag) {
      case "Facts":
        return `Facts ${block.title ?? ""}: ${block.rows.map((row) => `${row.label}=${row.value}${row.stacked === true ? " (stacked)" : ""}`).join(", ")}${(block.links ?? [])
          .map((link) => ` | ${link.title}${link.detail === undefined ? "" : ` ${link.detail}`} -> ${link.page}${describeParams(link.params)}`)
          .join("")}`;
      case "Link":
        return `Link ${block.title} -> ${block.page}`;
      case "Pinned":
        return `Pinned ${block.collection.page}${describeParams(block.collection.params)} suggesting ${(block.suggestions ?? []).join(" ")}`;
      case "Card":
        return `Card ${block.title} -> ${block.opens?.page ?? ""}: ${block.rows.map((row) => `${row.label}=${row.value}`).join(", ")} [${(block.actions ?? []).map((action) => action.title).join(", ")}]`;
      case "Actions":
        return `Actions: ${block.actions.map((action) => `${action.title}${action.destructive === true ? " (destructive)" : ""}`).join(", ")}`;
    }
  });

/** The npm registry, faked: pnpm's latest is 10.40.0, and a search finds
 * zod. With `down`, every call fails as an unreachable registry would. */
const fakeRegistry = (down: boolean) =>
  HttpClient.make((request, url) =>
    down
      ? Effect.succeed(HttpClientResponse.fromWeb(request, new Response("unavailable", { status: 503 })))
      : Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              url.pathname === "/-/v1/search"
                ? {
                    objects: [
                      {
                        package: {
                          name: "zod",
                          version: "4.0.0",
                          description: "TypeScript-first schema validation",
                        },
                      },
                    ],
                  }
                : { version: "10.40.0" },
            ),
          ),
        ),
  );

type Services = FileSystem.FileSystem | Path.Path | HttpClient.HttpClient | Scope.Scope;

const runWith = <A>(effect: Effect.Effect<A, unknown, Services>, registryDown: boolean) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, Layer.succeed(HttpClient.HttpClient, fakeRegistry(registryDown))))));

const run = <A>(effect: Effect.Effect<A, unknown, Services>) => runWith(effect, false);

const itemOf = (content: PluginCollectionContent, key: string): Effect.Effect<PluginItem> => {
  const item = content.items.find((candidate) => candidate.key === key);
  return item === undefined ? Effect.die(`no item ${key}`) : Effect.succeed(item);
};

const formOf = (item: PluginItem, command: string) => {
  const form = item.forms?.find((candidate) => candidate.command === command);
  return form === undefined ? Effect.die(`no form ${command}`) : Effect.succeed(form);
};

describe("npm plugin: scripts", () => {
  it("finds the workspace's packages and skips dependency and hidden folders", async () => {
    const content = await run(fixture.pipe(Effect.flatMap(scriptsFor)));
    expect(content.groups.map((group) => `${group.key}=${group.title}`)).toEqual([".=app", "tools=tools"]);
    expect(content.items.map((item) => `${item.key}=${item.name}`)).toEqual([".#build=build", ".#test=test", ".#prebuild=prebuild", "tools#gen=gen"]);
  });

  it("titles scripts for people and puts them in categories", async () => {
    const content = await run(fixture.pipe(Effect.flatMap(scriptsFor)));
    expect(content.items.map((item) => `${item.title}: ${item.categories.join(",")}`)).toEqual([
      "Build: build",
      "Test: test",
      "Before Build: build,clean",
      "Gen: generate",
    ]);
  });

  it("runs a script with the package's package manager", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(scriptsFor),
        Effect.flatMap((content) => itemOf(content, ".#build")),
        Effect.flatMap((item) => (item.run === undefined ? Effect.die("no run") : item.run.run)),
      ),
    );
    expect(result._tag === "RunTask" ? [result.command, ...result.args] : result._tag).toEqual(["pnpm", "run", "build"]);
  });

  it("prefers a package's own packageManager field", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(scriptsFor),
        Effect.flatMap((content) => itemOf(content, "tools#gen")),
        Effect.flatMap((item) => (item.run === undefined ? Effect.die("no run") : item.run.run)),
      ),
    );
    expect(result._tag === "RunTask" ? result.command : result._tag).toBe("yarn");
  });

  it("opens package.json at the script's own line", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(scriptsFor),
        Effect.flatMap((content) => itemOf(content, ".#test")),
        Effect.flatMap((item) => {
          const open = item.actions?.find((action) => action.command === "npm.open");
          return open === undefined ? Effect.die("no open") : open.run;
        }),
      ),
    );
    expect(result._tag === "OpenFile" ? result.line : result._tag).toBe(8);
  });

  it("edits a script in place, leaving the rest of package.json as it was", async () => {
    const text = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const content = yield* scriptsFor(app);
        const item = yield* itemOf(content, ".#test");
        const edit = yield* formOf(item, "npm.edit");
        yield* edit.submit({
          name: "test:unit",
          command: "vitest run --project unit",
        });
        return yield* fs.readFileString(path.join(app, "package.json"));
      }),
    );
    expect(text).toContain('    "test:unit": "vitest run --project unit",\n    "prebuild"');
    expect(text).toContain('  "devDependencies": {\n    "vitest": "^3.0.0"\n  }');
  });

  it("duplicates a script under a free name, and adds one to a package without scripts", async () => {
    const result = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const bare = path.join(app, "bare");
        yield* fs.makeDirectory(bare);
        yield* fs.writeFileString(path.join(bare, "package.json"), '{\n\t"name": "bare"\n}\n');
        const content = yield* scriptsFor(app);
        const item = yield* itemOf(content, ".#build");
        const duplicate = yield* formOf(item, "npm.duplicate");
        yield* duplicate.submit({
          name: duplicate.fields.find((field) => field.id === "name")?.value ?? "",
          command: "tsc -b --force",
        });
        if (content.create === undefined) return yield* Effect.die("no create form");
        yield* content.create.submit({
          package: "bare",
          name: "hello",
          command: "echo hi",
        });
        return {
          app: yield* fs.readFileString(path.join(app, "package.json")),
          bare: yield* fs.readFileString(path.join(bare, "package.json")),
        };
      }),
    );
    expect(result.app).toContain('    "prebuild": "rimraf dist",\n    "build-copy": "tsc -b --force"\n  },');
    expect(result.bare).toBe('{\n\t"name": "bare",\n\t"scripts": {\n\t\t"hello": "echo hi"\n\t}\n}\n');
  });

  it("refuses a name another script has", async () => {
    const error = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const content = yield* scriptsFor(app);
        const item = yield* itemOf(content, ".#test");
        const edit = yield* formOf(item, "npm.edit");
        return yield* edit
          .submit({
            name: "build",
            command: "x",
          })
          .pipe(Effect.flip);
      }),
    );
    expect(error.message).toContain('already a script named "build"');
  });

  it("has nothing to show where there is no package", async () => {
    const content = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const empty = yield* fs.makeTempDirectoryScoped();
        return yield* scriptsFor(empty);
      }),
    );
    expect(content.items).toEqual([]);
  });
});

describe("npm plugin: the NPM page", () => {
  it("is the project, its packages, its pinned scripts, and the package manager's card", async () => {
    const npm = await run(fixture.pipe(Effect.flatMap(pageFor("npm"))));
    expect(npm.title).toBe("PNPM");
    expect(describeBlocks(npm.blocks)).toEqual([
      "Facts : Name=app, Version=1.2.3, Description=The app (stacked) | All Details -> details(package=.)",
      "Facts Packages:  | Workspace Packages 1 -> workspace | Dependencies 0 -> packages(category=dependencies) | Development Dependencies 1 -> packages(category=dev)",
      "Pinned scripts suggesting .#build .#test .#prebuild",
      "Card pnpm -> packages: Version=10.33.4, Latest=10.40.0, Dependencies=0, Dev Dependencies=1, Workspace Packages=2 [Update to 10.40.0]",
    ]);
    expect(npm.menu?.map((form) => form.title)).toEqual(["Edit Package Details", "Install Dependency", "Install Dev Dependency", "New Workspace Package"]);
  });

  it("is the same page for one workspace package, scoped to it", async () => {
    const tools = await run(fixture.pipe(Effect.flatMap(pageFor("npm", { package: "tools" }))));
    expect(tools.title).toBe("tools");
    expect(describeBlocks(tools.blocks)).toEqual([
      "Facts : Name=tools, Folder=tools | All Details -> details(package=tools)",
      "Facts Packages:  | Dependencies 0 -> packages(group=tools,category=dependencies) | Development Dependencies 0 -> packages(group=tools,category=dev)",
      "Pinned scripts(group=tools) suggesting ",
    ]);
    expect(tools.menu?.map((form) => form.title)).toEqual(["Edit Package Details", "Install Dependency", "Install Dev Dependency"]);
  });

  it("lists the workspace packages, each opening its own page", async () => {
    const page = await run(fixture.pipe(Effect.flatMap(pageFor("workspace"))));
    expect(describeBlocks(page.blocks)).toEqual(["Facts :  | tools tools -> npm(package=tools)"]);
  });

  it("shows a dependency: asked for, installed, latest, and what can be done", async () => {
    const page = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.join(app, "node_modules", "vitest"), { recursive: true });
        yield* fs.writeFileString(path.join(app, "node_modules", "vitest", "package.json"), '{ "name": "vitest", "version": "3.2.4" }');
        return yield* pageFor("dependency", { package: ".", kind: "devDependencies", name: "vitest" })(app);
      }),
    );
    expect(page.title).toBe("vitest");
    expect(describeBlocks(page.blocks)).toEqual([
      "Facts : Status=Update available, Asked For=^3.0.0, Installed=3.2.4, Latest=10.40.0",
      "Facts In: Package=app, As=Dev Dependencies",
      "Actions: Update to 10.40.0, Update Within Range, Uninstall (destructive), View on npm",
    ]);
  });

  it("edits a package's details in place", async () => {
    const text = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const npm = yield* pageFor("npm")(app);
        const edit = npm.menu?.find((form) => form.command === "npm.editDetails");
        if (edit === undefined) return yield* Effect.die("no edit form");
        yield* edit.submit({
          name: "app",
          version: "1.3.0",
          description: "",
        });
        return yield* fs.readFileString(path.join(app, "package.json"));
      }),
    );
    expect(text.startsWith('{\n  "name": "app",\n  "version": "1.3.0",\n  "packageManager"')).toBe(true);
  });

  it("creates a workspace package, and says when pnpm-workspace.yaml does not take it in", async () => {
    const result = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(app, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
        const npm = yield* pageFor("npm")(app);
        const create = npm.menu?.find((form) => form.command === "npm.createPackage");
        if (create === undefined) return yield* Effect.die("no create form");
        const made = yield* create.submit({
          name: "@x/new",
          folder: "libs/new",
        });
        return {
          made,
          file: yield* fs.readFileString(path.join(app, "libs", "new", "package.json")),
        };
      }),
    );
    expect(result.file).toBe('{\n  "name": "@x/new",\n  "version": "0.0.0",\n  "private": true\n}\n');
    expect(result.made._tag === "Completed" ? result.made.messages : result.made._tag).toEqual([
      "Created @x/new in libs/new.",
      "pnpm-workspace.yaml does not take in libs/new yet; add it to its packages so pnpm links it.",
    ]);
  });

  it("installs into a pnpm workspace's root as the root", async () => {
    const result = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(path.join(app, "pnpm-workspace.yaml"), "packages:\n  - 'tools'\n");
        const npm = yield* pageFor("npm")(app);
        const install = npm.menu?.find((form) => form.command === "npm.installDevDependency");
        if (install === undefined) return yield* Effect.die("no install form");
        return yield* install.submit({
          name: "zod",
          version: "",
        });
      }),
    );
    expect(result._tag === "RunTask" ? [result.command, ...result.args] : result._tag).toEqual(["pnpm", "add", "zod", "--save-dev", "--workspace-root"]);
  });

  it("updates the package manager with its own command", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(pageFor("npm")),
        Effect.flatMap((npm) => {
          const card = npm.blocks.find((block) => block._tag === "Card");
          const update = card?._tag === "Card" ? card.actions?.[0] : undefined;
          return update === undefined ? Effect.die("no update action") : update.run;
        }),
      ),
    );
    expect(result._tag === "RunTask" ? [result.command, ...result.args] : result._tag).toEqual(["pnpm", "self-update"]);
  });

  it("says when the registry cannot be reached, and offers no update", async () => {
    const npm = await runWith(fixture.pipe(Effect.flatMap(pageFor("npm"))), true);
    const card = npm.blocks.find((block) => block._tag === "Card");
    expect(card?._tag === "Card" ? card.rows.find((row) => row.label === "Latest")?.value : undefined).toMatch(/^Couldn’t check: /);
    expect(card?._tag === "Card" ? card.actions : undefined).toEqual([]);
  });

  it("has all the details on its own page", async () => {
    const details = await run(fixture.pipe(Effect.flatMap(pageFor("details"))));
    expect(describeBlocks(details.blocks)).toEqual([
      "Facts Project: Name=app, Version=1.2.3, Description=The app (stacked)",
      "Facts Tooling: Package Manager=pnpm@10.33.4+sha512.abc (stacked)",
      "Facts Contents: Scripts=3, Dependencies=0, Dev Dependencies=1",
    ]);
  });

  it("is empty where there is no package", async () => {
    const npm = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* pageFor("npm")(yield* fs.makeTempDirectoryScoped());
      }),
    );
    expect(npm.blocks).toEqual([]);
  });
});

describe("npm plugin: packages", () => {
  it("lists each package's dependencies by kind, with what is installed", async () => {
    const content = await run(
      Effect.gen(function* () {
        const app = yield* fixture;
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.makeDirectory(path.join(app, "node_modules", "vitest"), { recursive: true });
        yield* fs.writeFileString(path.join(app, "node_modules", "vitest", "package.json"), '{ "name": "vitest", "version": "3.2.4" }');
        return yield* packagesFor(app);
      }),
    );
    expect(content.items.map((item) => `${item.key} ${item.name} ${item.detail ?? ""} [${item.categories.join(",")}]`)).toEqual([".#devDependencies#vitest ^3.0.0 Installed 3.2.4 [dev]"]);
  });

  it("installs with the package's own package manager, as the kind asked for", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(packagesFor),
        Effect.flatMap((content) =>
          content.create === undefined
            ? Effect.die("no install form")
            : content.create.submit({
                package: ".",
                name: "zod",
                version: "4",
                kind: "dev",
              }),
        ),
      ),
    );
    expect(result._tag === "RunTask" ? [result.command, ...result.args] : result._tag).toEqual(["pnpm", "add", "zod@4", "--save-dev"]);
  });

  it("updates and removes a dependency", async () => {
    const commands = await run(
      fixture.pipe(
        Effect.flatMap(packagesFor),
        Effect.flatMap((content) => itemOf(content, ".#devDependencies#vitest")),
        Effect.flatMap((item) =>
          Effect.forEach(
            (item.actions ?? []).filter((action) => action.command !== "npm.view"),
            (action) => action.run,
          ),
        ),
      ),
    );
    expect(commands.map((result) => (result._tag === "RunTask" ? result.args.join(" ") : result._tag))).toEqual(["update vitest", "remove vitest"]);
  });

  it("searches npm, each result installable", async () => {
    const found = await run(fixture.pipe(Effect.flatMap((app) => searchFor(app, "zod"))));
    expect(found.map((item) => `${item.title} ${item.name}`)).toEqual(["zod 4.0.0"]);
    expect(found[0]?.forms?.[0]?.fields.find((field) => field.id === "name")?.value).toBe("zod");
  });
});
