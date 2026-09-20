/**
 * The backend's HTTP surface as an Effect `HttpApi` — the off-vite API. Two
 * groups over the server-agnostic cores: `extensions` (install / list / remove)
 * and `config` (the device-synced app config). Served by serve.ts through
 * `@effect/platform-node`'s `NodeHttpServer` — no vite, no dev-server
 * middleware. As the other cores (fs.ts, …) migrate off their vite plugins,
 * they become groups here.
 *
 * @internal
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { ExtensionError } from "./extensions";
import { FontError } from "./fonts";

const ThemeContribution = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  uiTheme: Schema.optional(Schema.String),
  file: Schema.String,
  colors: Schema.optional(Schema.Struct({ primary: Schema.String, secondary: Schema.String })),
});

/** Wire shape of an installed extension's manifest (mirrors ExtensionManifest). */
export const ExtensionManifestSchema = Schema.Struct({
  id: Schema.String,
  publisher: Schema.String,
  name: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  iconThemes: Schema.Array(ThemeContribution),
  colorThemes: Schema.Array(ThemeContribution),
});

/** An extension discovered already installed in a local VS Code-family IDE. */
export const LocalExtensionSchema = Schema.Struct({
  id: Schema.String,
  publisher: Schema.String,
  name: Schema.String,
  version: Schema.String,
  displayName: Schema.String,
  description: Schema.String,
  iconThemes: Schema.Array(ThemeContribution),
  colorThemes: Schema.Array(ThemeContribution),
  source: Schema.String,
  sourcePath: Schema.String,
});

/** The synced app config is free-form JSON — the client owns its shape. */
export const AppConfigSchema = Schema.Record(Schema.String, Schema.Unknown);

const extensionsGroup = HttpApiGroup.make("extensions").add(
  HttpApiEndpoint.get("list", "/extensions", {
    success: Schema.Array(ExtensionManifestSchema),
    error: ExtensionError,
  }),
  HttpApiEndpoint.post("install", "/extensions/install", {
    payload: Schema.Struct({ ref: Schema.String }),
    success: ExtensionManifestSchema,
    error: ExtensionError,
  }),
  HttpApiEndpoint.post("remove", "/extensions/remove", {
    payload: Schema.Struct({ id: Schema.String }),
    success: Schema.Struct({ ok: Schema.Boolean }),
    error: ExtensionError,
  }),
  HttpApiEndpoint.get("discover", "/extensions/discover", {
    success: Schema.Array(LocalExtensionSchema),
    error: ExtensionError,
  }),
  HttpApiEndpoint.post("import", "/extensions/import", {
    payload: Schema.Struct({ path: Schema.String }),
    success: ExtensionManifestSchema,
    error: ExtensionError,
  }),
  HttpApiEndpoint.post("theme", "/extensions/theme", {
    payload: Schema.Struct({ file: Schema.String }),
    success: AppConfigSchema,
    error: ExtensionError,
  }),
);

const configGroup = HttpApiGroup.make("config").add(
  HttpApiEndpoint.get("configGet", "/config", {
    success: AppConfigSchema,
    error: ExtensionError,
  }),
  HttpApiEndpoint.post("configPut", "/config", {
    payload: AppConfigSchema,
    success: AppConfigSchema,
    error: ExtensionError,
  }),
);

const fontsGroup = HttpApiGroup.make("fonts").add(
  HttpApiEndpoint.post("inspect", "/fonts/inspect", {
    payload: Schema.Struct({ url: Schema.String }),
    success: Schema.Struct({ family: Schema.String }),
    error: FontError,
  }),
);

export const api = HttpApi.make("agent-console").add(extensionsGroup).add(configGroup).add(fontsGroup);
