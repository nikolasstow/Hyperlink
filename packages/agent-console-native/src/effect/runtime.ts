/**
 * The app's Effect runtime — the boundary between the Effect data layer and the
 * React screens.
 *
 * This is the first real increment of the move onto Effect/Last.ts: the data
 * modules (fsClient, repoScan, branchScan) are written as Effects that require
 * an `HttpClient`; the React screens stay React and consume them through
 * `runFs`, which provides that client (over the platform `fetch`) and hands the
 * result back as a Promise. Widening Effect up into the UI itself (View /
 * AtomReact / Last) is a later, larger step — see the Last.ts plan.
 *
 * One runtime for the process. It has no per-server state (the backend address
 * is passed to each call), so it never needs rebuilding on reconnect.
 *
 * @internal
 */
import { Effect, ManagedRuntime } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";

const runtime = ManagedRuntime.make(FetchHttpClient.layer);

/**
 * Run a data-layer Effect and get its result as a Promise for React. A typed
 * failure rejects the promise with that error value (so a caller can still
 * read its `_tag`); callers that treat failures as "absent" should catch.
 */
export const runFs = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>): Promise<A> =>
  runtime.runPromise(effect);
