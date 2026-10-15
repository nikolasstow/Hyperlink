/**
 * The model the API server runs on its own machine for inline suggestions
 * (agent-console-protocol `LocalModel`; docs/handoffs/code-intelligence.md):
 * llama.cpp's server with a Qwen2.5-Coder model, at `url`. Nothing is started
 * by hand: this service starts it (as the server starts, when it is on),
 * watches it until it answers, starts it again if it stops (backing off),
 * and stops it when it is turned off or the server goes. llama.cpp itself is
 * installed from the app (Homebrew) when it is missing.
 *
 * Its settings (on or off, which model) are kept in the state folder.
 *
 * @internal
 */
import { LocalModel as Wire } from "agent-console-protocol";
import { Duration, Effect, FiberHandle, FileSystem, Layer, Context, Option, Path, Schedule, Schema, Stream, SubscriptionRef } from "effect";
import { HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { stateDirectory } from "../sessions/files";

const SETTINGS_FILE = "local-model.json";
const PORT = 8012;
/** How long it is given to answer a health check. */
const HEALTH_WAIT = Duration.millis(500);
/** Where llama.cpp's server answers (this machine only). */
const localModelUrl = `http://127.0.0.1:${PORT}`;

/** Where Homebrew puts things, on Apple silicon and Intel Macs. */
const BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** How each model is started (llama.cpp's own presets where there is one). */
const ARGS: Readonly<Record<Wire.ModelId, ReadonlyArray<string>>> = {
  "qwen2.5-coder-7b-q4": [
    "-hf",
    "QuantFactory/Qwen2.5-Coder-7B-GGUF:Q4_K_M",
    "-hfd",
    "ggml-org/Qwen2.5-Coder-0.5B-Q8_0-GGUF",
    "-ub",
    "1024",
    "-b",
    "1024",
    "--cache-reuse",
    "256",
  ],
  "qwen2.5-coder-7b-q8": ["--fim-qwen-7b-spec"],
  "qwen2.5-coder-3b": ["--fim-qwen-3b-default"],
};

const restartBackoff = Schedule.exponential("2 seconds").pipe(Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.minutes(1)))));
const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Wire.Settings));

/** The model stopped (or never answered): why. */
class Stopped extends Schema.TaggedError<Stopped>()("LocalModel.Stopped", { message: Schema.String }) {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const http = yield* HttpClient.HttpClient;
  const settingsPath = path.join(stateDirectory((...parts) => path.join(...parts)), SETTINGS_FILE);

  const saved = yield* fs.readFileString(settingsPath).pipe(
    Effect.map((text) => Option.getOrElse(decodeSettings(text), () => Wire.DEFAULT_SETTINGS)),
    Effect.orElseSucceed(() => Wire.DEFAULT_SETTINGS),
  );
  const settings = yield* SubscriptionRef.make<Wire.Settings>(saved);
  const status = yield* SubscriptionRef.make<Wire.Status>({ state: "off", model: saved.model });
  const setStatus = (next: Wire.Status) => SubscriptionRef.set(status, next);

  /** A program in Homebrew's folders, if it is installed. */
  const find = (name: string) =>
    Effect.findFirst(BIN_DIRS, (dir) => fs.exists(path.join(dir, name)).pipe(Effect.orElseSucceed(() => false))).pipe(Effect.map(Option.map((dir) => path.join(dir, name))));
  const environment = { ...process.env, PATH: [...BIN_DIRS, process.env.PATH ?? ""].join(":") };

  /** Lines a process writes, both streams. */
  const linesOf = (handle: ChildProcessSpawner.ChildProcessHandle) =>
    Stream.merge(handle.stdout, handle.stderr).pipe(Stream.decodeText, Stream.splitLines);

  /** Whether it answers now. */
  const answers = http.get(`${localModelUrl}/health`).pipe(
    Effect.map((response) => response.status === 200),
    Effect.timeoutOrElse({ duration: HEALTH_WAIT, orElse: () => Effect.succeed(false) }),
    Effect.orElseSucceed(() => false),
  );

  /** Runs `model` until it stops: starting (with its download's progress),
   * then ready once it answers. Fails with why it stopped. When one already
   * answers on the port (another API server on this machine runs it), that
   * one is used, and watched: this one starts its own when it goes. */
  const run = (model: Wire.ModelId) =>
    Effect.gen(function* () {
      if (yield* answers) {
        yield* setStatus({ state: "ready", model, message: "Run by another server on this machine." });
        yield* answers.pipe(Effect.repeat({ schedule: Schedule.spaced("5 seconds"), while: (up) => up }));
        return yield* new Stopped({ message: "the model another server ran stopped" });
      }
      const binary = yield* find("llama-server");
      if (Option.isNone(binary)) {
        yield* setStatus({ state: "not-installed", model, message: "llama.cpp is not installed." });
        return yield* Effect.never;
      }
      yield* setStatus({ state: "starting", model });
      // In the server's process group (not detached): a server killed
      // outright (no time to stop it) takes it along.
      const handle = yield* spawner.spawn(
        ChildProcess.make(binary.value, [...ARGS[model], "--host", "127.0.0.1", "--port", String(PORT)], { env: environment, extendEnv: false, detached: false }),
      );
      yield* Effect.addFinalizer(() => handle.kill().pipe(Effect.ignore));
      // Its log: download progress while starting, the last line for a failure.
      let last = "";
      yield* linesOf(handle).pipe(
        Stream.runForEach((line) =>
          Effect.gen(function* () {
            if (line.trim() !== "") last = line.trim();
            const progress = /Downloading\s+(\S+)\D*?(\d+)%/.exec(line);
            const now = yield* SubscriptionRef.get(status);
            if (progress !== null && now.state === "starting") yield* setStatus({ state: "starting", model, message: `Downloading ${progress[1]} · ${progress[2]}%` });
          }),
        ),
        Effect.ignore,
        Effect.forkScoped,
      );
      // Ready once it answers.
      yield* answers.pipe(
        Effect.repeat({ schedule: Schedule.spaced("1 second"), until: (up) => up }),
        Effect.andThen(setStatus({ state: "ready", model })),
        Effect.forkScoped,
      );
      const code = yield* handle.exitCode.pipe(Effect.orElseSucceed(() => -1));
      const message = `llama.cpp stopped (exit ${code})${last === "" ? "" : `: ${last.slice(0, 200)}`}`;
      yield* setStatus({ state: "failed", model, message });
      return yield* new Stopped({ message });
    }).pipe(
      Effect.scoped,
      Effect.tapError((error) => Effect.logWarning(`[local model] ${error.message}; starting it again`)),
      Effect.retry(restartBackoff),
    );

  // One run at a time: a change of settings stops it and starts it afresh.
  const runner = yield* FiberHandle.make();
  const apply = (next: Wire.Settings) =>
    next.enabled ? setStatus({ state: "starting", model: next.model }).pipe(Effect.andThen(FiberHandle.run(runner, run(next.model))), Effect.asVoid) : FiberHandle.clear(runner).pipe(Effect.andThen(setStatus({ state: "off", model: next.model })));
  yield* apply(saved);

  const overview = Effect.all({ settings: SubscriptionRef.get(settings), status: SubscriptionRef.get(status) });
  const failed = (message: string) => (cause: unknown) => new Wire.LocalModelError({ message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}` });

  return {
    /** Its settings and state now. */
    overview,
    /** Where it answers. */
    url: localModelUrl,
    /** Whether it answers now (suggestions use it only then). */
    ready: SubscriptionRef.get(status).pipe(Effect.map((now) => now.state === "ready")),
    /** Turns it on or off, or changes the model: kept, and applied at once. */
    setSettings: (next: Wire.Settings) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(settingsPath), { recursive: true }).pipe(Effect.ignore);
        yield* fs.writeFileString(settingsPath, JSON.stringify(next)).pipe(Effect.mapError(failed("keeping the settings failed")));
        yield* SubscriptionRef.set(settings, next);
        yield* apply(next);
        return yield* overview;
      }),
    /** Installs llama.cpp with Homebrew, then starts the model (when on). */
    install: Effect.gen(function* () {
      const brew = yield* find("brew");
      if (Option.isNone(brew)) return yield* new Wire.LocalModelError({ message: "Homebrew is not installed on the server (https://brew.sh)." });
      const now = yield* SubscriptionRef.get(settings);
      yield* setStatus({ state: "installing", model: now.model });
      yield* Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make(brew.value, ["install", "llama.cpp"], { env: environment, extendEnv: false }));
        yield* linesOf(handle).pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
        const code = yield* handle.exitCode.pipe(Effect.orElseSucceed(() => -1));
        if (code !== 0) yield* setStatus({ state: "failed", model: now.model, message: `brew install llama.cpp failed (exit ${code})` });
        else yield* apply(now);
      }).pipe(Effect.scoped, Effect.forkDetach);
      return yield* overview;
    }),
    /** Stops it and starts it again (when on). */
    restart: Effect.gen(function* () {
      yield* apply(yield* SubscriptionRef.get(settings));
      return yield* overview;
    }),
  };
});

/** The local model. Needs Node's file system, paths, processes, and an HTTP
 * client (to see it answer). */
export class LocalModel extends Context.Service<LocalModel, Effect.Success<typeof make>>()("agent-console/server/localModel/LocalModel") {
  static readonly layer = Layer.effect(LocalModel, make);
}
