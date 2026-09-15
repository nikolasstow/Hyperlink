/**
 * File-type icons — the real VS Code default (Seti) icon set, extracted to SVG
 * glyphs (see setiIcons.ts). Every file resolves to something: an unknown
 * extension falls back to Seti's own plain-document glyph.
 *
 * Resolution matches VS Code: an exact (lowercased) filename wins first, then
 * the extension — trying the longest dotted chain first ("spec.ts" before "ts",
 * "tf.json" before "json") — then the default. Only `iconForFile` and the
 * renderer (SetiIcon) know about the glyph source; callers just get a spec.
 *
 * @internal
 */
import { setiByExt, setiByName, setiDefaultGlyph, setiGlyphs } from "./setiIcons";

export type FileIconSpec = {
  /** Key into `setiGlyphs` — the SVG path + colour SetiIcon draws. */
  readonly glyph: string;
  readonly color: string;
};

/** The icon for a file by its name. */
export const iconForFile = (name: string): FileIconSpec => {
  const glyph = resolveGlyph(name.toLowerCase());
  return { glyph, color: setiGlyphs[glyph]?.color ?? setiGlyphs[setiDefaultGlyph].color };
};

const resolveGlyph = (lower: string): string => {
  const byName = setiByName[lower];
  if (byName !== undefined) return byName;

  // Try each dotted suffix, longest first: "a.spec.ts" → "spec.ts" then "ts".
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const byExt = setiByExt[parts.slice(i).join(".")];
    if (byExt !== undefined) return byExt;
  }
  return setiDefaultGlyph;
};
