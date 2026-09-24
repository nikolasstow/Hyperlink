/**
 * Child-process helpers shared by the variant scripts — every git / pnpm / expo /
 * eas call goes through `ChildProcessSpawner`, and a non-zero exit is a typed
 * failure naming the command.
 */
import { Data, Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class CommandFailedError extends Data.TaggedError("CommandFailedError")<{
  readonly command: string;
  readonly exitCode: number;
}> {}

export interface CommandSpec {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}

const display = (spec: CommandSpec) => [spec.command, ...spec.args].join(" ");

/** Run with the terminal attached (output streams live); fails on a non-zero exit. */
export const runInherit = (spec: CommandSpec) =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.flatMap((spawner) =>
      spawner.exitCode(
        ChildProcess.make(spec.command, [...spec.args], {
          cwd: spec.cwd,
          extendEnv: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      ),
    ),
    Effect.filterOrFail(
      (code) => code === 0,
      (code) =>
        new CommandFailedError({
          command: display(spec),
          exitCode: code,
        }),
    ),
    Effect.asVoid,
  );

/** Run and capture stdout (trimmed); stderr passes through to the terminal. Fails on
 * a non-zero exit, so a failed command never reads as empty output. */
export const runString = (spec: CommandSpec) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(
      ChildProcess.make(spec.command, [...spec.args], {
        cwd: spec.cwd,
        extendEnv: true,
        stderr: "inherit",
      }),
    );
    const [output, code] = yield* Effect.all([handle.stdout.pipe(Stream.decodeText, Stream.mkString), handle.exitCode], {
      concurrency: 2,
    });
    if (code !== 0) {
      return yield* new CommandFailedError({
        command: display(spec),
        exitCode: code,
      });
    }
    return output.trim();
  }).pipe(Effect.scoped);

/** Exit status only (for probes like `git show-ref --verify`); output discarded. */
export const probe = (spec: CommandSpec) =>
  ChildProcessSpawner.ChildProcessSpawner.pipe(
    Effect.flatMap((spawner) =>
      spawner.exitCode(
        ChildProcess.make(spec.command, [...spec.args], {
          cwd: spec.cwd,
          extendEnv: true,
          stdout: "ignore",
          stderr: "ignore",
        }),
      ),
    ),
    Effect.map((code) => code === 0),
  );
