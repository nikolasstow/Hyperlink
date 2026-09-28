import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer, Stream, type Path, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { Workspaces } from "../workspaces";
import { cleanEnvironment, ProcessRunner } from "./runner";

const runnerLayer = ProcessRunner.layer.pipe(Layer.provideMerge(Workspaces.layer), Layer.provideMerge(NodeServices.layer));

/** A registered workspace under the home folder (the files root). */
const registeredWorkspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ directory: process.env.HOME });
  const real = yield* fs.realPath(dir);
  const workspaces = yield* Workspaces;
  yield* workspaces.register([real]);
  return real;
});

const collect = (id: string) =>
  ProcessRunner.pipe(
    Effect.flatMap((runner) => runner.follow(id)),
    Effect.flatMap((stream) => stream.pipe(Stream.decodeText, Stream.mkString)),
  );

const run = <A, E>(effect: Effect.Effect<A, E, ProcessRunner | Workspaces | FileSystem.FileSystem | Path.Path | Scope.Scope>) =>
  Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(runnerLayer)));

describe("process runner", () => {
  it("runs an allowed program in a registered workspace and streams its output, then its exit", async () => {
    const text = await run(
      Effect.gen(function* () {
        const cwd = yield* registeredWorkspace;
        const runner = yield* ProcessRunner;
        const { id } = yield* runner.start({
          command: "node",
          args: ["-e", "console.log('one'); console.error('two'); process.exit(4)"],
          cwd,
        });
        return yield* collect(id);
      }),
    );
    expect(text).toContain('event: line\ndata: {"stream":"stdout","text":"one"}');
    expect(text).toContain('event: line\ndata: {"stream":"stderr","text":"two"}');
    expect(text.trim().endsWith('event: exit\ndata: {"exitCode":4}')).toBe(true);
  });

  it("replays a finished process in full to a late viewer", async () => {
    const [first, second] = await run(
      Effect.gen(function* () {
        const cwd = yield* registeredWorkspace;
        const runner = yield* ProcessRunner;
        const { id } = yield* runner.start({
          command: "node",
          args: ["-e", "console.log('a'); console.log('b')"],
          cwd,
        });
        const live = yield* collect(id);
        const late = yield* collect(id);
        return [live, late];
      }),
    );
    expect(second).toBe(first);
  });

  it("refuses a folder that is not a registered workspace", async () => {
    const error = await run(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const elsewhere = yield* fs.makeTempDirectoryScoped({ directory: process.env.HOME });
        const runner = yield* ProcessRunner;
        return yield* runner
          .start({
            command: "node",
            args: ["-v"],
            cwd: elsewhere,
          })
          .pipe(Effect.flip);
      }),
    );
    expect(error._tag === "ProcessRequestError" ? error.reason : error._tag).toBe("OutsideWorkspaces");
  });

  it("refuses a program that is not on the allowlist", async () => {
    const error = await run(
      Effect.gen(function* () {
        const cwd = yield* registeredWorkspace;
        const runner = yield* ProcessRunner;
        return yield* runner
          .start({
            command: "bash",
            args: ["-c", "echo hi"],
            cwd,
          })
          .pipe(Effect.flip);
      }),
    );
    expect(error._tag === "ProcessRequestError" ? error.reason : error._tag).toBe("CommandNotAllowed");
  });

  it("stops a running process and reports that it ended", async () => {
    const text = await run(
      Effect.gen(function* () {
        const cwd = yield* registeredWorkspace;
        const runner = yield* ProcessRunner;
        const { id } = yield* runner.start({
          command: "node",
          args: ["-e", "setInterval(() => console.log('tick'), 50)"],
          cwd,
        });
        yield* Effect.sleep("200 millis");
        yield* runner.stop(id);
        return yield* collect(id);
      }),
    );
    expect(text).toContain("tick");
    expect(text.trim().endsWith("event: exit\ndata: {}")).toBe(true);
  });

  it("knows no process by an unknown id", async () => {
    const error = await run(
      ProcessRunner.pipe(
        Effect.flatMap((runner) => runner.follow("nope")),
        Effect.flip,
      ),
    );
    expect(error.reason).toBe("UnknownProcess");
  });
});

describe("the environment a process starts with", () => {
  it("leaves out what running the server through pnpm added", () => {
    const clean = cleanEnvironment({
      HOME: "/Users/me",
      PNPM_HOME: "/Users/me/Library/pnpm",
      PATH: [
        "/repo/packages/agent-console/node_modules/.bin",
        "/Users/me/.cache/node/corepack/v1/pnpm/10.33.4/dist/node-gyp-bin",
        "/repo/node_modules/.bin",
        "/usr/local/bin",
        "/usr/bin",
      ].join(":"),
      NODE_PATH: "/repo/node_modules/.pnpm/node_modules",
      INIT_CWD: "/repo/packages/agent-console",
      PNPM_SCRIPT_SRC_DIR: "/repo/packages/agent-console",
      npm_lifecycle_event: "serve",
      npm_config_user_agent: "pnpm/10.33.4",
      UNSET: undefined,
    });
    expect(clean).toEqual({
      HOME: "/Users/me",
      PNPM_HOME: "/Users/me/Library/pnpm",
      PATH: "/usr/local/bin:/usr/bin",
    });
  });
});
