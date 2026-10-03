import { Effect, HashMap, Layer, Option, Stream } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, it } from "vitest";
import { SessionBackgrounds } from "./SessionBackgrounds";

const deviceStorage = () => {
  const stored = new Map<string, string>();
  return Layer.succeed(KeyValueStore.KeyValueStore)(
    KeyValueStore.makeStringOnly({
      get: (key) => Effect.sync(() => stored.get(key)),
      set: (key, value) => Effect.sync(() => void stored.set(key, value)),
      remove: (key) => Effect.sync(() => void stored.delete(key)),
      clear: Effect.sync(() => stored.clear()),
      size: Effect.sync(() => stored.size),
    }),
  );
};

const run = <A, E>(program: Effect.Effect<A, E, SessionBackgrounds>, storage: ReturnType<typeof deviceStorage>) =>
  Effect.runPromise(program.pipe(Effect.provide(SessionBackgrounds.layer.pipe(Layer.provide(storage))), Effect.scoped));

const current = (backgrounds: SessionBackgrounds["Service"]) => backgrounds.changes.pipe(Stream.take(1), Stream.runHead, Effect.map(Option.getOrThrow));

describe("SessionBackgrounds", () => {
  it("keeps each mode's colour, and a session with neither goes back to the app's", async () => {
    const storage = deviceStorage();
    const [set, cleared] = await run(
      Effect.gen(function* () {
        const backgrounds = yield* SessionBackgrounds;
        yield* backgrounds.set("ses_1", "light", "#FFEEDD");
        yield* backgrounds.set("ses_1", "dark", "#112233");
        const afterSet = yield* current(backgrounds);
        yield* backgrounds.set("ses_1", "light", undefined);
        yield* backgrounds.set("ses_1", "dark", undefined);
        const afterClear = yield* current(backgrounds);
        return [afterSet, afterClear];
      }),
      storage,
    );
    expect(Option.getOrUndefined(HashMap.get(set, "ses_1"))).toEqual({ light: "#FFEEDD", dark: "#112233" });
    expect(HashMap.has(cleared, "ses_1")).toBe(false);
  });

  it("reads back what was kept when the app opens again", async () => {
    const storage = deviceStorage();
    await run(
      Effect.gen(function* () {
        const backgrounds = yield* SessionBackgrounds;
        yield* backgrounds.set("ses_1", "dark", "#112233");
      }),
      storage,
    );
    const kept = await run(
      Effect.gen(function* () {
        return yield* current(yield* SessionBackgrounds);
      }),
      storage,
    );
    expect(Option.getOrUndefined(HashMap.get(kept, "ses_1"))?.dark).toBe("#112233");
  });
});
