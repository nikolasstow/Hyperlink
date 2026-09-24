/**
 * App-variant naming — the one definition shared by app.config.js (CommonJS, as Expo
 * and EAS evaluate it) and the TypeScript variant scripts.
 */

/** The uncommitted per-worktree marker that selects a variant: `{ "variant": "<name>" }`. */
const variantMarkerFile = "app-variant.json";

/** The generated per-variant icon (base icon + name banner), relative to the package. */
const variantIconFile = "assets/variant-icon.png";

/**
 * Reverse-DNS-safe, filesystem-safe, branch-safe slug for a variant name.
 * @param {string} name
 * @returns {string}
 */
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

module.exports = {
  variantMarkerFile,
  variantIconFile,
  slugify,
};
