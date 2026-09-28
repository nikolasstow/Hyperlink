/**
 * The installed plugins: where each one's folder is, and its manifest.
 *
 * The one list the extension host loads plugins from and the plugin manager
 * shows, so the two can never disagree. Today that is the plugins that ship
 * with the backend; installing from the store adds to it.
 *
 * @internal
 */
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect";
import { manifestFile, pluginManifest } from "./manifest";

/** The plugins that ship with the backend, as folders under ../plugins. */
const builtinPlugins: ReadonlyArray<string> = ["npm"];

export class PluginRegistryError extends Schema.TaggedErrorClass<PluginRegistryError>()("PluginRegistryError", {
  message: Schema.String,
}) {}

/** An installed plugin as the plugin manager shows it. */
export class InstalledPlugin extends Schema.Class<InstalledPlugin>("InstalledPlugin")({
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
}) {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dirs = yield* Effect.forEach(builtinPlugins, (name) =>
    path.fromFileUrl(new URL(`../plugins/${name}`, import.meta.url)).pipe(
      Effect.mapError((cause) => new PluginRegistryError({ message: `built-in plugin ${name}: ${cause.message}` })),
    ),
  );

  const list = Effect.forEach(dirs, (dir) =>
    fs.readFileString(path.join(dir, manifestFile)).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(pluginManifest))),
      Effect.map(
        (manifest) =>
          new InstalledPlugin({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            ...(manifest.description === undefined ? {} : { description: manifest.description }),
            source: "built-in",
            permissions: manifest.permissions ?? [],
            pages: (manifest.contributes.pages ?? []).map((page) => ({
              id: page.id,
              title: page.title,
              ...(page.icon === undefined ? {} : { icon: page.icon }),
              requirement: page.requirement,
            })),
          }),
      ),
      Effect.mapError((cause) => new PluginRegistryError({ message: `${dir}: ${String(cause)}` })),
    ),
  );

  return {
    /** Every installed plugin's folder, for the host to load. */
    dirs,
    /** Every installed plugin, as the plugin manager shows it. */
    list,
  };
});

export class PluginRegistry extends Context.Service<PluginRegistry, Effect.Success<typeof make>>()("agent-console/PluginRegistry") {
  static readonly layer = Layer.effect(PluginRegistry, make);
}
