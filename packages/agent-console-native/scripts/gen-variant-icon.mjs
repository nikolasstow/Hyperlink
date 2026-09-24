/**
 * Generate a distinctive variant app icon: the base icon with a colored banner
 * across the TOP carrying the variant name. The banner color is chosen from a
 * preset palette by hashing the name — so it looks random across variants but is
 * STABLE for a given name (re-generating yields the same icon).
 */
import sharp from "sharp";

const SIZE = 1024;
/** Banner height — a slim strip across the top. */
const BAND_H = 200;
/** Largest font; long names shrink below this. Big enough that short names nearly
 * fill the band height (little top/bottom space). */
const MAX_FONT = 150;
/** Horizontal padding inside the band. */
const PAD_X = 70;
/** Approx width of a bold-uppercase glyph in ems (for the fit estimate). */
const GLYPH_EM = 0.62;

/** Preset banner colors (distinct, iOS-system-ish). */
export const PRESETS = [
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
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** A preset color for a name — stable per name, spread across the palette. */
export const pickColor = (name) => PRESETS[hash(name) % PRESETS.length];

const escapeXml = (s) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

/** Write `out` = `baseIcon` with a slim top color banner labelled `name`. */
export const genVariantIcon = async ({ name, baseIcon, out }) => {
  const label = name.toUpperCase();
  const color = pickColor(name);
  const maxTextWidth = SIZE - 2 * PAD_X;
  // Longer names get a smaller font (down to a floor) so they stay readable…
  const fontSize = Math.max(28, Math.min(MAX_FONT, Math.floor(maxTextWidth / (label.length * GLYPH_EM))));
  // …and textLength hard-caps the rendered width, so the text can NEVER overflow
  // the band regardless of how the estimate lands (SVG compresses to fit).
  const textLength = Math.min(Math.round(label.length * fontSize * GLYPH_EM), maxTextWidth);
  const svg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${SIZE}" height="${BAND_H}" fill="${color}"/>
  <text x="${SIZE / 2}" y="${BAND_H / 2}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800" font-size="${fontSize}" letter-spacing="1" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central" textLength="${textLength}" lengthAdjust="spacingAndGlyphs">${escapeXml(label)}</text>
</svg>`;
  await sharp(baseIcon)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(out);
  return { color, fontSize };
};
