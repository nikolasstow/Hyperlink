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
import { Effect, FileSystem, Path, Schema } from "effect";

// fontkit + wawoff2 are CommonJS and don't ESM-default-import under tsx/Node
// ESM, so pull them in via createRequire (typed to the bits we use).
const nodeRequire = createRequire(import.meta.url);
const fontkit: { create: (buffer: Buffer) => Font | FontCollection } = nodeRequire("fontkit");
const wawoff2: { decompress: (bytes: Uint8Array) => Promise<Uint8Array> } = nodeRequire("wawoff2");

export class FontError extends Schema.TaggedErrorClass<FontError>()("FontError", {
  reason: Schema.Literals(["download", "parse", "io", "unsupported"]),
  detail: Schema.optional(Schema.String),
}) {}

const fontsDir = (path: Path.Path): string => process.env.AGENT_CONSOLE_FONTS_DIR ?? path.join(process.cwd(), ".agent-console", "fonts");

/** 4-byte sfnt/woff tag at the start of the file. */
const magic = (bytes: Uint8Array): string => String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);

const fnv = (input: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

const familyOf = (bytes: Uint8Array): string => {
  const parsed = fontkit.create(Buffer.from(bytes));
  const font = "familyName" in parsed ? parsed : parsed.fonts[0];
  const family = str(font.familyName);
  if (family === undefined) throw new Error("no family name in font");
  return family;
};

/**
 * Import a font by URL for on-device use: download it, convert WOFF2→TTF (iOS
 * can't render WOFF), keep TTF/OTF as-is, store it in the server font cache, and
 * return its family name + the stored file id (served at /fonts/file?id=…).
 */
export const importFont = (url: string): Effect.Effect<{ family: string; fileId: string }, FontError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const raw = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      catch: (error) => new FontError({ reason: "download", detail: String(error) }),
    });

    const tag = magic(raw);
    let bytes: Uint8Array;
    if (tag === "wOF2") {
      bytes = yield* Effect.tryPromise({
        try: async () => new Uint8Array(await wawoff2.decompress(raw)),
        catch: (error) => new FontError({ reason: "parse", detail: `woff2: ${String(error)}` }),
      });
    } else if (tag === "wOFF") {
      return yield* new FontError({ reason: "unsupported", detail: "WOFF 1.0 isn't supported yet — use TTF, OTF, or WOFF2" });
    } else {
      bytes = raw;
    }

    const family = yield* Effect.try({ try: () => familyOf(bytes), catch: (error) => new FontError({ reason: "parse", detail: String(error) }) });
    const ext = magic(bytes) === "OTTO" ? "otf" : "ttf";
    const fileId = `${family.replace(/[^A-Za-z0-9._-]/g, "_")}-${fnv(url)}.${ext}`;

    const dir = fontsDir(path);
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
    yield* fs.writeFile(path.join(dir, fileId), bytes).pipe(Effect.mapError((error) => new FontError({ reason: "io", detail: String(error) })));
    return { family, fileId };
  });

/** Read a stored (converted) font's bytes by id, for serving to devices. */
export const readFontFile = (id: string): Effect.Effect<Uint8Array, FontError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (id.includes("/") || id.includes("..")) return yield* new FontError({ reason: "io", detail: "bad id" });
    const abs = path.join(fontsDir(path), id);
    const has = yield* fs.exists(abs).pipe(Effect.orElseSucceed(() => false));
    if (!has) return yield* new FontError({ reason: "io", detail: "not found" });
    return yield* fs.readFile(abs).pipe(Effect.mapError((error) => new FontError({ reason: "io", detail: String(error) })));
  });

/** Details read from a font file for the confirm/details step. */
export interface FontDetails {
  readonly family: string;
  readonly subfamily?: string;
  readonly fullName?: string;
  readonly version?: string;
  readonly copyright?: string;
  readonly numGlyphs?: number;
}

const str = (value: string | null | undefined): string | undefined => (value === null || value === undefined || value === "" ? undefined : value);

/** Download a font by URL and read its embedded details (family name, etc.). */
export const inspectFont = (url: string): Effect.Effect<FontDetails, FontError> =>
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
        const family = str(font.familyName);
        if (family === undefined) throw new Error("no family name in font");
        return {
          family,
          ...(str(font.subfamilyName) === undefined ? {} : { subfamily: str(font.subfamilyName) }),
          ...(str(font.fullName) === undefined ? {} : { fullName: str(font.fullName) }),
          ...(font.version === null || font.version === undefined ? {} : { version: String(font.version) }),
          ...(str(font.copyright) === undefined ? {} : { copyright: str(font.copyright) }),
          ...(typeof font.numGlyphs === "number" ? { numGlyphs: font.numGlyphs } : {}),
        };
      },
      catch: (error) => new FontError({ reason: "parse", detail: String(error) }),
    });
  });
