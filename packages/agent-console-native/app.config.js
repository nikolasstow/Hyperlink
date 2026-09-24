/**
 * Dynamic Expo config — app VARIANTS.
 *
 * The static config still lives in app.json; this wraps it. With no variant
 * selected it returns app.json UNCHANGED (the base build is identical). With a
 * variant selected it gives the app a distinct bundle identifier / name / scheme,
 * so it installs ALONGSIDE the base app (and any other variant) as a separate
 * app with its own sandboxed storage — one worktree ⇄ one install ⇄ one local
 * agent, none of them colliding.
 *
 * Selecting a variant (either works; the file wins, so an EAS *cloud* build —
 * which evaluates this on its servers, where our local env isn't present — can
 * still pick it up):
 *   - `APP_VARIANT=<name>` in the environment, or
 *   - an `app-variant.json` next to this file: `{ "variant": "<name>" }`
 *     (uncommitted, per-worktree; see scripts/new-variant-worktree.mjs).
 *
 * Variants are a CLEAN CORE app: the native extensions (widgets / Live Activity /
 * Siri intents / notification-service via @bacons/apple-targets + withAppIntents)
 * and the shared App Group are dropped. Those are all hardcoded to the base App
 * Group `group.com.nikolasstow.agentconsolenative`, so across side-by-side
 * installs they would collide or mis-provision. The base build keeps them all.
 */
const fs = require("fs");
const path = require("path");

/** Reverse-DNS-safe, filesystem-safe slug for a variant name. */
const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);

/** The variant from the environment, or from an uncommitted app-variant.json. A
 * MISSING file means "base build" (expected); a MALFORMED file throws loudly. */
const resolveVariant = () => {
  const fromEnv = process.env.APP_VARIANT;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const file = path.join(__dirname, "app-variant.json");
  if (!fs.existsSync(file)) return undefined;
  const value = JSON.parse(fs.readFileSync(file, "utf8")).variant;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`app-variant.json must contain a non-empty "variant" string, got: ${JSON.stringify(value)}`);
  }
  return value.trim();
};

/** Plugin entries to strip from a variant (their native extensions can't coexist
 * across installs without their own bundle IDs + App Group, which they hardcode). */
const EXTENSION_PLUGINS = new Set(["@bacons/apple-targets", "./plugins/withAppIntents.js"]);

module.exports = ({ config }) => {
  const variant = resolveVariant();
  if (variant === undefined) return config;

  const slug = slugify(variant);
  if (slug.length === 0) {
    throw new Error(`Variant "${variant}" has no usable slug (need at least one alphanumeric character).`);
  }

  const ios = { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.${slug}` };

  // Drop the extension-only entitlements (App Group + push-communication), which
  // reference the base App Group and would clash across installs.
  if (ios.entitlements !== undefined) {
    const entitlements = { ...ios.entitlements };
    delete entitlements["com.apple.security.application-groups"];
    delete entitlements["com.apple.developer.usernotifications.communication"];
    ios.entitlements = entitlements;
  }
  // Drop the extension-driven Info.plist keys (Live Activity + Siri intents).
  if (ios.infoPlist !== undefined) {
    const infoPlist = { ...ios.infoPlist };
    delete infoPlist.NSSupportsLiveActivities;
    delete infoPlist.NSSupportsLiveActivitiesFrequentUpdates;
    delete infoPlist.NSUserActivityTypes;
    ios.infoPlist = infoPlist;
  }

  const plugins = (config.plugins ?? []).filter((entry) => !EXTENSION_PLUGINS.has(Array.isArray(entry) ? entry[0] : entry));

  // Distinctive icon (base + top name banner) if the worktree script generated one.
  const variantIcon = fs.existsSync(path.join(__dirname, "assets", "variant-icon.png"))
    ? "./assets/variant-icon.png"
    : config.icon;

  return {
    ...config,
    name: `${config.name} · ${variant}`,
    scheme: `${config.scheme}${slug.replace(/-/g, "")}`,
    icon: variantIcon,
    ios,
    plugins,
  };
};
