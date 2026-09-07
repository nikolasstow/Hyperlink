/**
 * Directory listing + text read against OUR vite backend's `/fs` endpoints,
 * NOT opencode's file API — as Effect. The backend owns the machine's
 * filesystem and is where every IDE-shaped feature lives (opencode is only the
 * agent), so repo discovery, branch reads and the file explorer all go through
 * here.
 *
 * The response is `Schema`-decoded (the shape crosses a network boundary, so it
 * is validated, not trusted), and failures are a single `FsError` tagged-error
 * channel. A missing path (404) is a normal, expected result — an empty listing
 * or `undefined` text — while a transport/server/decode failure is a real error
 * a caller can surface; the top-level repo scan does exactly that.
 *
 * Requires an `HttpClient`, provided by the app runtime — run these through
 * `runFs` (effect/runtime.ts) at the React boundary.
 *
 * @internal
 */
import { Data, Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

export const FsEntry = Schema.Struct({
  name: Schema.String,
  type: Schema.Literals(["file", "directory"]),
});
export type FsEntry = typeof FsEntry.Type;

const FsListing = Schema.Struct({
  path: Schema.String,
  entries: Schema.Array(FsEntry),
});

export class FsError extends Data.TaggedError("FsError")<{
  readonly reason: "transport" | "http" | "decode";
  readonly path: string;
  readonly status?: number;
}> {}

const listUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}/fs/list?path=${encodeURIComponent(path)}`;
const readUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, "")}/fs/read?path=${encodeURIComponent(path)}`;

/** Directory entries at `path`. Empty for a path that doesn't exist (404);
 * fails with `FsError` on a transport/server/decode error. */
export const fsList = (base: string, path: string): Effect.Effect<ReadonlyArray<FsEntry>, FsError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(listUrl(base, path)).pipe(
      Effect.mapError(() => new FsError({ reason: "transport", path })),
    );
    if (response.status === 404) return [];
    if (response.status >= 400) return yield* new FsError({ reason: "http", path, status: response.status });
    const listing = yield* HttpClientResponse.schemaBodyJson(FsListing)(response).pipe(
      Effect.mapError(() => new FsError({ reason: "decode", path })),
    );
    return listing.entries;
  });

/** Text contents of `path`, or undefined if it doesn't exist (404); fails with
 * `FsError` on a transport/server error. */
export const fsReadText = (base: string, path: string): Effect.Effect<string | undefined, FsError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.get(readUrl(base, path)).pipe(
      Effect.mapError(() => new FsError({ reason: "transport", path })),
    );
    if (response.status === 404) return undefined;
    if (response.status >= 400) return yield* new FsError({ reason: "http", path, status: response.status });
    return yield* response.text.pipe(Effect.mapError(() => new FsError({ reason: "transport", path })));
  });
