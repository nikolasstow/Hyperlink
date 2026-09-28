/**
 * Client for the installed plugins (`GET /plugins` on the Effect API server),
 * what the plugin manager shows. Same conventions as extensionsClient: plain
 * `fetch`, `Schema`-decoded responses, a non-2xx surfaced with its message.
 *
 * @internal
 */
import { Schema } from "effect";
import { base, request } from "./extensionsClient";

const installedPlugin = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.optionalKey(Schema.String),
  source: Schema.Literals(["built-in"]),
  permissions: Schema.Array(Schema.String),
  pages: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      icon: Schema.optionalKey(Schema.String),
      requirement: Schema.Literals(["none", "repo", "file"]),
    }),
  ),
});
export type InstalledPlugin = typeof installedPlugin.Type;
export type PluginPageInfo = InstalledPlugin["pages"][number];

export const listPlugins = async (apiBase: string): Promise<ReadonlyArray<InstalledPlugin>> =>
  Schema.decodeUnknownSync(Schema.Array(installedPlugin))(await request(`${base(apiBase)}/plugins`));

/** A page's requirement, as a person reads it. */
export const requirementText = (requirement: PluginPageInfo["requirement"]): string =>
  requirement === "none" ? "Works anywhere" : requirement === "repo" ? "Opens in a repo" : "Opens on a file from a repo";

/** A declared permission, as a person reads it. */
export const permissionText = (permission: string): string =>
  permission === "processes"
    ? "Runs programs in your repos"
    : permission === "network"
      ? "Uses the network"
      : permission === "write"
        ? "Changes files in your repos"
        : permission;
