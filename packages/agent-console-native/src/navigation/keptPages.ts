/**
 * The pages open when the app was last used (the root stack, bottom to top),
 * kept on the device so a launch after the app was closed opens them again.
 *
 * Kept as names and JSON params only: a page whose params do not survive JSON
 * is not kept, nor any page above it (each is reached from the one below).
 *
 * @internal
 */
import { Option, Schema } from "effect";

export const KeptPage = Schema.Struct({
  name: Schema.String,
  params: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});
export type KeptPage = typeof KeptPage.Type;

export const KeptPages = Schema.Array(KeptPage);
export type KeptPages = typeof KeptPages.Type;

/** A route as the navigator has it. */
export interface PageRoute {
  readonly name: string;
  readonly params?: object;
}

const decodeParams = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json));

/** A route's params as JSON, its unset fields dropped; none when any is not
 * JSON (a function, a Map: what it is would be lost). */
const jsonParams = (params: object): Option.Option<KeptPage["params"]> =>
  decodeParams(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)));

/** The pages to keep: the routes up to the first whose params are not JSON. */
export const keptPagesOf = (routes: ReadonlyArray<PageRoute>): KeptPages => {
  const kept: Array<KeptPage> = [];
  for (const route of routes) {
    if (route.params === undefined) {
      kept.push({ name: route.name });
      continue;
    }
    const params = jsonParams(route.params);
    if (Option.isNone(params)) break;
    kept.push({ name: route.name, params: params.value });
  }
  return kept;
};

/** The page on top, or undefined with none kept. */
export const topPage = (pages: KeptPages): KeptPage | undefined => pages[pages.length - 1];
