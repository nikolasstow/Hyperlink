/**
 * The extension code themes fetched from the server, kept on the device so
 * the editor draws in the enabled theme from the first frame after a launch,
 * not in the bundled fallback until the server answers. Read back at launch
 * (useCodeTheme.ts); replaced whenever the server sends a theme again.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { themeJson } from "./extensionsClient";

const STORE_KEY = "themes";

/** Each kept theme's JSON, by its file on the server. */
const keptThemes = Schema.Record(Schema.String, themeJson);

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, keptThemes);
  const all = store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof keptThemes.Type => ({}))),
    Effect.catch((error) => Effect.logError("[themes] the kept themes could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  return {
    /** Every kept theme, by file. */
    all,
    /** Keeps a theme as the server sent it. */
    keep: (file: string, theme: typeof themeJson.Type) =>
      all.pipe(
        Effect.flatMap((kept) =>
          store.set(STORE_KEY, {
            ...kept,
            [file]: theme,
          }),
        ),
        Effect.catch((error) => Effect.logError("[themes] keeping a theme failed", error)),
      ),
  };
});

export class KeptThemes extends Context.Service<KeptThemes, Effect.Success<typeof make>>()("@doubleagent/KeptThemes") {
  static readonly layer = Layer.effect(KeptThemes, make);
}
