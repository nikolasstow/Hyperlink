/**
 * Custom code fonts — server side. Fonts aren't extensions; the only thing the
 * server does is inspect one: download the file and read its embedded family
 * name (fonts carry their own name), so the client never has to ask the user to
 * type it. The font list itself lives in the synced app config, client-managed.
 *
 * @internal
 */
import { createRequire } from "node:module";
import type { Font, FontCollection } from "fontkit";
import { Effect, Schema } from "effect";

// fontkit is CommonJS and doesn't ESM-default-import under tsx/Node ESM, so pull
// it in via createRequire (typed to the bit we use).
const nodeRequire = createRequire(import.meta.url);
const fontkit: { create: (buffer: Buffer) => Font | FontCollection } = nodeRequire("fontkit");

export class FontError extends Schema.TaggedErrorClass<FontError>()("FontError", {
  reason: Schema.Literals(["download", "parse"]),
  detail: Schema.optional(Schema.String),
}) {}

/** Download a font by URL and return its embedded family name. */
export const inspectFont = (url: string): Effect.Effect<{ family: string }, FontError> =>
  Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      },
      catch: (error) => new FontError({ reason: "download", detail: String(error) }),
    });
    return yield* Effect.try({
      try: () => {
        const parsed = fontkit.create(bytes);
        // A collection (.ttc) exposes `fonts`; a single font has `familyName`.
        const font = "familyName" in parsed ? parsed : parsed.fonts[0];
        const family = font.familyName;
        if (family === null || family === undefined || family === "") throw new Error("no family name in font");
        return { family };
      },
      catch: (error) => new FontError({ reason: "parse", detail: String(error) }),
    });
  });
