import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Option, Path, Stream } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { FileSync, TextChange } from "file-sync";
import { describe, expect, it } from "vitest";
import { FileHub } from "../files/hub";
import { LanguageHost } from "./host";

/** opencode's event stream, quiet (no agent marks in these tests); nothing
 * else is found (so no ESLint server: TypeScript's problems only). */
const quietOpencode = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, request.url.endsWith("/api/event") ? new Response(new ReadableStream<Uint8Array>()) : new Response(null, { status: 404 }))),
  ),
);

const SOURCE = 'export const bad: number = "x";\nexport const ok = 1;\n';

/** Run `body` against a real language server over a temp repo holding `file.ts`. */
const withHost = <A, E>(body: (context: { readonly host: LanguageHost["Service"]; readonly hub: FileHub["Service"]; readonly file: string }) => Effect.Effect<A, E, LanguageHost | FileHub | FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
    yield* fs.makeDirectory(path.join(root, ".git"));
    yield* fs.writeFileString(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "ESNext" } }));
    const file = path.join(root, "file.ts");
    yield* fs.writeFileString(file, SOURCE);
    process.env.AGENT_CONSOLE_FS_ROOT = root;
    // Its own state folder: no ESLint server fetched before.
    process.env.AGENT_CONSOLE_STATE_DIR = path.join(root, ".state");
    const hubLive = Layer.fresh(FileHub.layer).pipe(Layer.provide(quietOpencode));
    return yield* Effect.gen(function* () {
      return yield* body({ host: yield* LanguageHost, hub: yield* FileHub, file });
    }).pipe(Effect.provide(Layer.mergeAll(LanguageHost.layer, hubLive).pipe(Layer.provide([hubLive, quietOpencode]))));
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        delete process.env.AGENT_CONSOLE_FS_ROOT;
        delete process.env.AGENT_CONSOLE_STATE_DIR;
      }),
    ),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

describe("LanguageHost", () => {
  it("streams a file's problems as offsets, and their clearing once the hub has a fix", { timeout: 60_000 }, async () => {
    const seen = await Effect.runPromise(
      withHost(({ host, hub, file }) =>
        Effect.gen(function* () {
          const first = yield* host.diagnostics(file).pipe(
            Stream.filter((next) => next.diagnostics.length > 0),
            Stream.runHead,
          );
          // The fix goes through the hub, as the app's write does.
          const synced = yield* hub.follow(file).pipe(Stream.runHead);
          const version = Option.match(synced, { onNone: () => 0, onSome: (event) => (event instanceof FileSync.Synced ? event.version : 0) });
          const epoch = Option.match(synced, { onNone: () => "", onSome: (event) => (event instanceof FileSync.Synced ? event.epoch : "") });
          yield* hub.write(FileSync.WriteRequest.make({ path: file, epoch, baseVersion: version, clientID: "test", changes: TextChange.diff(SOURCE, SOURCE.replace('"x"', "2")) }));
          const cleared = yield* host.diagnostics(file).pipe(
            Stream.filter((next) => next.diagnostics.length === 0),
            Stream.runHead,
          );
          return { first, cleared };
        }),
      ),
    );
    const problem = Option.getOrUndefined(seen.first)?.diagnostics[0];
    expect(problem?.severity).toBe("error");
    expect(problem?.source).toBe("typescript");
    expect(problem?.message).toContain("not assignable");
    expect(SOURCE.slice(problem?.start ?? 0, problem?.end ?? 0)).toBe("bad");
    expect(Option.isSome(seen.cleared)).toBe(true);
  });

  it("gives an agent the problems of what it just wrote to disk, as lines and columns", { timeout: 60_000 }, async () => {
    const seen = await Effect.runPromise(
      withHost(({ host, file }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const before = yield* host.problems(file);
          // Written as an agent writes: to disk, not through the hub.
          yield* fs.writeFileString(file, SOURCE.replace('"x"', "2"));
          const fixed = yield* host.problems(file);
          yield* fs.writeFileString(file, `${SOURCE}export const worse: string = 3;\n`);
          const broken = yield* host.problems(file);
          const open = yield* host.openProblems;
          return { before, fixed, broken, open };
        }),
      ),
    );
    expect(seen.before.problems).toMatchObject([{ line: 1, column: 14, endLine: 1, endColumn: 17, severity: "error", source: "typescript" }]);
    expect(seen.fixed.problems).toEqual([]);
    expect(seen.fixed.version).toBeGreaterThan(seen.before.version);
    expect(seen.broken.problems.map((problem) => problem.line)).toEqual([1, 3]);
    expect(seen.open.map((file) => file.path)).toEqual([seen.broken.path]);
  });

  it("answers what is at a place", { timeout: 60_000 }, async () => {
    const hover = await Effect.runPromise(withHost(({ host, file }) => host.hover(file, SOURCE.indexOf("ok") + 1)));
    const info = Option.getOrUndefined(hover);
    expect(info?.markdown).toContain("const ok: 1");
    expect(SOURCE.slice(info?.start ?? 0, info?.end ?? 0)).toBe("ok");
  });

  it("knows the names valid where a suggestion's prefix ends", { timeout: 60_000 }, async () => {
    const context = await Effect.runPromise(withHost(({ host }) => host.contextAt(`${process.env.AGENT_CONSOLE_FS_ROOT ?? ""}/file.ts`, "export const ok = 1;\n")));
    // The prefix ends at the end of the file: names from the file and the language are offered.
    expect(context.names.some((name) => name.startsWith("ok"))).toBe(true);
  });

  it("knows nothing where the prefix is not in the server's copy (edits not saved yet)", { timeout: 60_000 }, async () => {
    const context = await Effect.runPromise(withHost(({ host, file }) => host.contextAt(file, "text that is nowhere in the file")));
    expect(context).toEqual({ names: [] });
  });

  it("refuses a file no server here knows", { timeout: 60_000 }, async () => {
    const error = await Effect.runPromise(withHost(({ host, file }) => host.hover(file.replace(/\.ts$/, ".md"), 0)).pipe(Effect.flip));
    expect(error._tag === "LanguageError" ? error.reason : error._tag).toBe("Unsupported");
  });
});
