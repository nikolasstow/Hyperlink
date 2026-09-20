/**
 * Custom code fonts. Fonts aren't extensions — just a family name and a source
 * (a URL to a .ttf/.otf/.woff2, or later an uploaded file). They live in the
 * synced app config (`config.fonts`), so they travel across devices like the
 * theme, without the extension store.
 *
 * Rendering a custom font on device needs `expo-font` (a native module → a
 * build); until that ships, a custom font can be added/selected here and will
 * apply once the build lands. Managing the list needs no build.
 *
 * @internal
 */
import { Schema } from "effect";
import { base, getRemoteConfig, putRemoteConfig, request } from "./extensionsClient";

export interface CustomFont {
  readonly family: string;
  /** Direct URL to a font file (later: an uploaded-file reference). */
  readonly url: string;
}

const CustomFontSchema = Schema.Struct({
  family: Schema.String,
  url: Schema.String,
});
const decodeFonts = Schema.decodeUnknownSync(Schema.Array(CustomFontSchema));

const readFonts = (config: Record<string, unknown>): ReadonlyArray<CustomFont> => {
  if (!("fonts" in config)) return [];
  try {
    return decodeFonts(config.fonts);
  } catch {
    return [];
  }
};

const decodeFamily = Schema.decodeUnknownSync(Schema.Struct({ family: Schema.String }));

/** Inspect a font URL server-side and return its embedded family name. */
export const inspectFont = async (apiBase: string, url: string): Promise<string> => {
  const result = decodeFamily(
    await request(`${base(apiBase)}/fonts/inspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }),
  );
  return result.family;
};

export const getCustomFonts = async (apiBase: string): Promise<ReadonlyArray<CustomFont>> => readFonts(await getRemoteConfig(apiBase));

/** Add (or replace by family) a custom font, then return the updated list. */
export const addCustomFont = async (apiBase: string, font: CustomFont): Promise<ReadonlyArray<CustomFont>> => {
  const existing = readFonts(await getRemoteConfig(apiBase));
  const next = [...existing.filter((f) => f.family !== font.family), font];
  return readFonts(await putRemoteConfig(apiBase, { fonts: next }));
};

export const removeCustomFont = async (apiBase: string, family: string): Promise<ReadonlyArray<CustomFont>> => {
  const existing = readFonts(await getRemoteConfig(apiBase));
  const next = existing.filter((f) => f.family !== family);
  return readFonts(await putRemoteConfig(apiBase, { fonts: next }));
};
