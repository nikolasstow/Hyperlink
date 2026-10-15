/**
 * App-variant naming — the one definition shared by app.config.js (CommonJS, as Expo
 * and EAS evaluate it), the TypeScript variant scripts, and the API server's
 * `pnpm pair` (which links to this variant's app). Types: variant.d.ts.
 */
const fs = require("node:fs");
const path = require("node:path");

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

/**
 * The variant this package builds, if any: `APP_VARIANT` in the environment, else
 * the `app-variant.json` marker in `dir`.
 * @param {string} dir the package folder
 * @returns {string | undefined}
 */
const resolveVariant = (dir) => {
  const fromEnv = process.env.APP_VARIANT;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const file = path.join(dir, variantMarkerFile);
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, "utf8")).variant;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${variantMarkerFile} must contain a non-empty "variant" string, got: ${JSON.stringify(value)}`);
  }
  return value.trim();
};

/**
 * The URL scheme an app registers: the base app's, else the base plus the
 * variant's slug without dashes (each variant opens its own links).
 * @param {string} baseScheme app.json's `scheme`
 * @param {string | undefined} variant
 * @returns {string}
 */
const appScheme = (baseScheme, variant) => (variant === undefined ? baseScheme : `${baseScheme}${slugify(variant).replace(/-/g, "")}`);

module.exports = {
  variantMarkerFile,
  variantIconFile,
  slugify,
  resolveVariant,
  appScheme,
};
