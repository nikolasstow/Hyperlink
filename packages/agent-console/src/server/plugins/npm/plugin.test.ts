import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import type { PluginNode } from "../../plugin/api";
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
      '  "scripts": {',
      '    "build": "tsc -b",',
      '    "test": "vitest run"',
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

const treeFor = (workspace: string) => {
  const view = plugin.views["npm"];
  if (view === undefined) throw new Error("the npm view is missing");
  return view.tree({ workspace });
};

const run = <A>(effect: Effect.Effect<A, unknown, FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

const script = (tree: ReadonlyArray<PluginNode>, pkg: string, name: string) =>
  tree.find((node) => node.label === pkg)?.children?.find((child) => child.label === name);

describe("npm plugin", () => {
  it("finds the workspace's packages and skips dependency and hidden folders", async () => {
    const tree = await run(fixture.pipe(Effect.flatMap(treeFor)));
    expect(tree.map((node) => node.label)).toEqual(["package.json", "tools/package.json"]);
    expect(tree[0]?.description).toBe("app");
    expect(tree[0]?.children?.map((child) => `${child.label}=${child.description ?? ""}`)).toEqual(["build=tsc -b", "test=vitest run"]);
  });

  it("runs a script with the monorepo root's package manager, found above the workspace", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(treeFor),
        Effect.flatMap((tree) => {
          const action = script(tree, "package.json", "build")?.actions?.find((candidate) => candidate.command === "npm.run");
          if (action === undefined) return Effect.die("no run action");
          return action.run;
        }),
      ),
    );
    expect(result._tag).toBe("RunTask");
    if (result._tag !== "RunTask") return;
    expect(result.command).toBe("pnpm");
    expect(result.args).toEqual(["run", "build"]);
  });

  it("prefers a package's own packageManager field", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(treeFor),
        Effect.flatMap((tree) => {
          const action = script(tree, "tools/package.json", "gen")?.actions?.find((candidate) => candidate.command === "npm.run");
          if (action === undefined) return Effect.die("no run action");
          return action.run;
        }),
      ),
    );
    expect(result._tag === "RunTask" ? result.command : result._tag).toBe("yarn");
  });

  it("opens package.json at the script's own line", async () => {
    const result = await run(
      fixture.pipe(
        Effect.flatMap(treeFor),
        Effect.flatMap((tree) => {
          const open = script(tree, "package.json", "test")?.open;
          if (open === undefined) return Effect.die("no open action");
          return open.run;
        }),
      ),
    );
    expect(result._tag === "OpenFile" ? result.line : result._tag).toBe(5);
  });

  it("has nothing to show where there is no package", async () => {
    const tree = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const empty = yield* fs.makeTempDirectoryScoped();
        return yield* treeFor(empty);
      }),
    );
    expect(tree).toEqual([]);
  });
});
