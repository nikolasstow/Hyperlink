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
 * Selecting a variant (the environment wins when set; the file is what an EAS
 * *cloud* build sees, since it evaluates this on its servers without our env):
 *   - `APP_VARIANT=<name>` in the environment, or
 *   - an `app-variant.json` next to this file: `{ "variant": "<name>" }`
 *     (uncommitted, per-worktree; see scripts/worktree-setup.ts).
 *
 * Variants are a CLEAN CORE app: the native extensions (widgets / Live Activity /
 * Siri intents / notification-service via @bacons/apple-targets + withAppIntents)
 * and the shared App Group are dropped. Those are all hardcoded to the base App
 * Group `group.com.nikolasstow.agentconsolenative`, so across side-by-side
 * installs they would collide or mis-provision. The base build keeps them all.
 */
const fs = require("fs");
const path = require("path");
const { appScheme, resolveVariant, slugify, variantIconFile } = require("./variant");

/** The variant from the environment, or from an uncommitted app-variant.json. A
 * MISSING file means "base build" (expected); a MALFORMED file throws loudly. */

/** Plugin entries to strip from a variant (their native extensions can't coexist
 * across installs without their own bundle IDs + App Group, which they hardcode). */
const EXTENSION_PLUGINS = new Set(["@bacons/apple-targets", "./plugins/withAppIntents.js"]);

module.exports = ({ config }) => {
  const variant = resolveVariant(__dirname);
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
  const variantIcon = fs.existsSync(path.join(__dirname, variantIconFile)) ? `./${variantIconFile}` : config.icon;

  return {
    ...config,
    name: `${config.name} · ${variant}`,
    scheme: appScheme(config.scheme, variant),
    icon: variantIcon,
    ios,
    plugins,
  };
};
