/**
 * The custom code fonts, installed on the device: each font in the synced list
 * (fontsClient.ts) is downloaded once into the app's documents, kept there,
 * and registered with the system for the app (the native editor's
 * `registerFont`), so the editor, the code surface and any text can draw in
 * it by family name. At launch the kept files are registered again before the
 * app shows; after that the list is kept in step with the server.
 *
 * @internal
 */
import { Context, Data, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { Directory, File, Paths } from "expo-file-system";
import { canInstallFonts, registerFont, unregisterFont } from "../../modules/code-editor";
import type { CustomFont } from "../fontsClient";

const STORE_KEY = "fonts";

/** A font on the device: where it came from and the file it is in. */
const keptFont = Schema.Struct({
  url: Schema.String,
  file: Schema.String,
});
/** The fonts on the device, by family. */
const keptFonts = Schema.Record(Schema.String, keptFont);

export class FontInstallError extends Data.TaggedError("FontInstallError")<{
  readonly family: string;
  readonly reason: string;
}> {}

/** The folder the fonts are kept in. */
const fontsFolder = (): Directory => new Directory(Paths.document, "fonts");

/** A file name for a family: its letters and digits only. */
const fileNameOf = (family: string): string => `${family.replace(/[^A-Za-z0-9]+/g, "-")}.font`;

/** A font's address: as given when absolute, else on the API `server`. */
const addressOf = (server: string, url: string): string => (/^https?:\/\//.test(url) ? url : `${server.replace(/\/$/, "")}${url}`);

const register = (family: string, file: string) =>
  Effect.tryPromise({
    try: () => registerFont(file),
    catch: (error) => new FontInstallError({ family, reason: `registering ${file}: ${String(error)}` }),
  });

const download = (family: string, address: string) =>
  Effect.tryPromise({
    try: async () => {
      const folder = fontsFolder();
      if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
      const file = await File.downloadFileAsync(address, new File(folder, fileNameOf(family)), { idempotent: true });
      return file.uri;
    },
    catch: (error) => new FontInstallError({ family, reason: `downloading ${address}: ${String(error)}` }),
  });

const remove = (file: string) =>
  Effect.promise(() => unregisterFont(file)).pipe(
    Effect.andThen(
      Effect.sync(() => {
        const kept = new File(file);
        if (kept.exists) kept.delete();
      }),
    ),
  );

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, keptFonts);
  const kept = store.get(STORE_KEY).pipe(
    Effect.map(Option.getOrElse((): typeof keptFonts.Type => ({}))),
    Effect.catch((error) => Effect.logError("[fonts] the kept fonts could not be read; starting without them", error).pipe(Effect.as({}))),
  );
  const keep = (next: typeof keptFonts.Type) => store.set(STORE_KEY, next).pipe(Effect.catch((error) => Effect.logError("[fonts] keeping the font list failed", error)));
  /** The families installed now, by family: the file each is in. */
  const installed = yield* SubscriptionRef.make<ReadonlyMap<string, string>>(new Map());

  return {
    /** The installed fonts as they change (family → file). */
    changes: SubscriptionRef.changes(installed),
    /** Registers the fonts kept on the device (at launch). */
    readBack: kept.pipe(
      Effect.flatMap((fonts) =>
        Effect.forEach(Object.entries(fonts), ([family, font]) =>
          register(family, font.file).pipe(
            Effect.as(Option.some<readonly [string, string]>([family, font.file])),
            Effect.catch((error) => Effect.logError("[fonts] a kept font could not be registered", error).pipe(Effect.as(Option.none<readonly [string, string]>()))),
          ),
        ),
      ),
      Effect.flatMap((registered) => SubscriptionRef.set(installed, new Map(registered.flatMap((entry) => Option.toArray(entry))))),
      (readBack) => (canInstallFonts ? readBack : Effect.void),
    ),
    /** Brings the device in step with the server's list: downloads and
     * registers fonts it lacks (or whose source changed), removes the ones no
     * longer listed. A font that fails stays out, logged, and is tried again
     * next time. */
    sync: (server: string, fonts: ReadonlyArray<CustomFont>) =>
      kept.pipe(
        Effect.flatMap((current) =>
          Effect.gen(function* () {
            const listed = new Set(fonts.map((font) => font.family));
            const next: Record<string, typeof keptFont.Type> = {};
            for (const [family, font] of Object.entries(current)) {
              if (listed.has(family)) next[family] = font;
              else yield* remove(font.file);
            }
            for (const font of fonts) {
              if (next[font.family]?.url === font.url) continue;
              const file = yield* download(font.family, addressOf(server, font.url)).pipe(
                Effect.tap((uri) => register(font.family, uri)),
                Effect.map(Option.some),
                Effect.catch((error) => Effect.logError("[fonts] a font could not be installed", error).pipe(Effect.as(Option.none<string>()))),
              );
              if (Option.isSome(file)) next[font.family] = { url: font.url, file: file.value };
            }
            yield* keep(next);
            yield* SubscriptionRef.set(installed, new Map(Object.entries(next).map(([family, font]) => [family, font.file])));
          }),
        ),
        (sync) => (canInstallFonts ? sync : Effect.void),
      ),
  };
});

export class CodeFonts extends Context.Service<CodeFonts, Effect.Success<typeof make>>()("@doubleagent/fonts/CodeFonts") {
  static readonly layer = Layer.effect(CodeFonts, make);
}
