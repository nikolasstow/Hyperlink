/**
 * The npm registry, for what the workspace alone cannot say: which packages
 * match a search, and a package's latest version (the package manager's own,
 * for its update button). Reached through the host's HTTP client, which the
 * plugin's `network` permission covers.
 *
 * @internal
 */
import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { PluginError } from "../../plugin/api";

const registry = "https://registry.npmjs.org";

/** How long a registry call may take before it counts as failed. */
const deadline = Duration.seconds(8);

const searchResponse = Schema.Struct({
  objects: Schema.Array(
    Schema.Struct({
      package: Schema.Struct({
        name: Schema.String,
        version: Schema.String,
        description: Schema.optionalKey(Schema.String),
      }),
    }),
  ),
});

export type RegistryPackage = (typeof searchResponse.Type)["objects"][number]["package"];

const latestResponse = Schema.Struct({
  version: Schema.String,
});

const getJson = <S extends Schema.Constraint>(url: string, schema: S, what: string) =>
  HttpClient.get(url).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () => Effect.fail(new PluginError({ message: `the npm registry did not answer ${what} within ${Duration.format(deadline)}` })),
    }),
    Effect.mapError((cause) => (cause instanceof PluginError ? cause : new PluginError({ message: `${what} failed: ${cause.message}` }))),
  );

/** Packages on npm matching `query`, best first. */
export const searchRegistry = (query: string, size: number) =>
  getJson(`${registry}/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`, searchResponse, `searching npm for "${query}"`).pipe(
    Effect.map((response): ReadonlyArray<RegistryPackage> => response.objects.map((object) => object.package)),
  );

/** A package's latest published version. */
export const latestVersion = (name: string) =>
  getJson(`${registry}/${name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name)}/latest`, latestResponse, `looking up ${name}'s latest version`).pipe(
    Effect.map((response) => response.version),
  );

/** A package's page on npmjs.com. */
export const packageUrl = (name: string): string => `https://www.npmjs.com/package/${name}`;
