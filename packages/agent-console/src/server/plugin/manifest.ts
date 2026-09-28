/**
 * A plugin's manifest, `doubleagent-plugin.json`: who it is, where its server
 * module is, and what it contributes. Pages carry the requirement that decides
 * where they can go (docs/handoffs/double-agent-repo-screen-and-plugin-system.md
 * §4.2, §22.1).
 *
 * @internal
 */
import { Schema } from "effect";
import { PageKind } from "../extensionHost/protocol";

export const manifestFile = "doubleagent-plugin.json";

/** What a page needs to open: nothing, a repo, or a file from a repo. */
export const pageRequirement = Schema.Literals(["none", "repo", "file"]);

export const pluginPage = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** `codicon:<name>` or `sf:<SF Symbol>`. */
  icon: Schema.optionalKey(Schema.String),
  requirement: pageRequirement,
  /** How the app draws it (protocol.ts `PageKind`), filled by the plugin's
   * view, summary or collection of the same name (`view`, or the page's own
   * id). */
  kind: PageKind,
  view: Schema.optionalKey(Schema.String),
  /** The page this one opens from. A page with a parent is reached through
   * it (a summary's links), not from the menu. */
  parent: Schema.optionalKey(Schema.String),
});
export type PluginPage = typeof pluginPage.Type;

export const pluginManifest = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** The server module, relative to the manifest. */
  main: Schema.String,
  contributes: Schema.Struct({
    pages: Schema.optionalKey(Schema.Array(pluginPage)),
  }),
  /** What the plugin's server code does beyond reading the workspace, shown
   * at install. */
  permissions: Schema.optionalKey(Schema.Array(Schema.Literals(["processes", "network", "write"]))),
});
export type PluginManifest = typeof pluginManifest.Type;
