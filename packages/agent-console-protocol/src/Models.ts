/**
 * The model catalog: the providers opencode is configured with in a folder,
 * and their models, as `GET /models?directory=…` streams them (one line of
 * NDJSON each), so an app can show them as they come and keep them.
 *
 * Only what a model picker needs travels: ids and names. opencode's own
 * provider records carry API keys; they stay on the server.
 *
 * @since 0.0.1
 */
import { Schema } from "effect";

/** Where the catalog is served. */
export const path = "/models";

/** A model, as a picker shows it. */
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type Model = typeof Model.Type;

/** A configured provider and its models. */
export const Provider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  models: Schema.Array(Model),
});
export type Provider = typeof Provider.Type;

/** One line of the catalog: a provider, then (last) each provider's default model. */
export const Line = Schema.Union([
  Schema.TaggedStruct("Provider", {
    provider: Provider,
  }),
  Schema.TaggedStruct("Defaults", {
    defaults: Schema.Record(Schema.String, Schema.String),
  }),
]);
export type Line = typeof Line.Type;
