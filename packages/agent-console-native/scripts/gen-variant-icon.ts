/**
 * Generate a distinctive variant app icon: the base icon with a colored banner
 * across the TOP carrying the variant name. The banner color is chosen from a
 * preset palette by hashing the name — so it looks random across variants but is
 * STABLE for a given name (re-generating yields the same icon).
 */
import { Data, Effect } from "effect";
import sharp from "sharp";

export class IconRenderError extends Data.TaggedError("IconRenderError")<{
  readonly out: string;
  readonly cause: unknown;
}> {}

const size = 1024;
/** Banner height — a slim strip across the top. */
const bandHeight = 200;
/** Largest font; long names shrink below this. Big enough that short names nearly
 * fill the band height (little top/bottom space). */
const maxFont = 150;
/** Smallest font a long name shrinks to. */
const minFont = 28;
/** Horizontal padding inside the band. */
const padX = 70;
/** Approx width of a bold-uppercase glyph in ems (for the fit estimate). */
const glyphEm = 0.62;

/** Preset banner colors (distinct, iOS-system-ish). A non-empty tuple, so the
 * first entry is always there. */
const presets: readonly [string, ...Array<string>] = [
  "#FF3B30", // red
  "#FF9500", // orange
  "#FFCC00", // yellow
  "#34C759", // green
  "#00C7BE", // teal
  "#007AFF", // blue
  "#5856D6", // indigo
  "#AF52DE", // purple
  "#FF2D55", // pink
];

/** FNV-1a — stable across runs (unlike Math.random or object hashing). */
const hash = (s: string) => s.split("").reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** A preset color for a name — stable per name, spread across the palette. The
 * modulo keeps the index in range; the tuple head only satisfies the index type. */
const pickColor = (name: string) => presets[hash(name) % presets.length] ?? presets[0];

/** `&` first, so the entities the later steps insert aren't escaped again. */
const escapeXml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;")
    .replaceAll('"', "&quot;");

export interface VariantIconOptions {
  readonly name: string;
  readonly baseIcon: string;
  readonly out: string;
}

/** Write `out` = `baseIcon` with a slim top color banner labelled `name`. */
export const genVariantIcon = (options: VariantIconOptions) => {
  const label = options.name.toUpperCase();
  const maxTextWidth = size - 2 * padX;
  // Longer names get a smaller font (down to a floor) so they stay readable…
  const fontSize = Math.max(minFont, Math.min(maxFont, Math.floor(maxTextWidth / (label.length * glyphEm))));
  // …and textLength hard-caps the rendered width, so the text can NEVER overflow
  // the band regardless of how the estimate lands (SVG compresses to fit).
  const textLength = Math.min(Math.round(label.length * fontSize * glyphEm), maxTextWidth);
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${size}" height="${bandHeight}" fill="${pickColor(options.name)}"/>
  <text x="${size / 2}" y="${bandHeight / 2}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="1" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central" textLength="${textLength}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text>
</svg>`;
  return Effect.tryPromise({
    try: () =>
      sharp(options.baseIcon)
        .composite([
          {
            input: Buffer.from(svg),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toFile(options.out),
    catch: (cause) =>
      new IconRenderError({
        out: options.out,
        cause,
      }),
  }).pipe(Effect.asVoid);
};
