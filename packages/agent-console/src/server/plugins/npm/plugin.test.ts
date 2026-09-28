import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import type { PluginCollectionContent, PluginItem } from "../../plugin/api";
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
  return collection.content({ workspace });
};

const summaryFor = (workspace: string) => {
  const summary = plugin.summaries?.["npm"];
  if (summary === undefined) throw new Error("the npm summary is missing");
  return summary.summary({ workspace });
};

const run = <A>(effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

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
    expect(content.items.map((item) => `${item.key}=${item.detail ?? ""}`)).toEqual([".#build=tsc -b", ".#test=vitest run", ".#prebuild=rimraf dist", "tools#gen=node gen.js"]);
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
    expect(result._tag === "OpenFile" ? result.line : result._tag).toBe(7);
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

describe("npm plugin: summary", () => {
  it("summarizes the root package.json and its package manager", async () => {
    const summary = await run(fixture.pipe(Effect.flatMap(summaryFor)));
    expect(summary.sections.map((section) => [section.title ?? "", section.rows.map((row) => `${row.label}=${row.value}`)])).toEqual([
      ["", ["Name=app", "Version=1.2.3"]],
      ["Package Manager", ["Manager=pnpm", "Version=10.33.4"]],
      ["Workspace", ["Packages=2", "Scripts=4", "Dependencies=0", "Dev Dependencies=1"]],
    ]);
  });

  it("is empty where there is no package", async () => {
    const summary = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        return yield* summaryFor(yield* fs.makeTempDirectoryScoped());
      }),
    );
    expect(summary.sections).toEqual([]);
  });
});
