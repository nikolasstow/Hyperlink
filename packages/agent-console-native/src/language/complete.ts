/**
 * Inline suggestions from the API server (`POST /complete`,
 * agent-console-protocol `Complete`): what to insert at the caret, as it
 * grows. The answer streams (server-sent events), so its client reads it as
 * it comes (expo/fetch: React Native's own fetch reads a body whole).
 *
 * @internal
 */
import { Complete } from "agent-console-protocol";
import { Context, Data, Effect, Layer, Schema, Stream } from "effect";
import { Sse } from "effect/encoding";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

/** How much of the text either side of the caret goes with the request. */
const PREFIX_CHARS = 4000;
const SUFFIX_CHARS = 1500;

const decodeResponse = Schema.decodeEffect(Schema.fromJsonString(Complete.Response));

/** The server said why there is no suggestion. */
export class NoSuggestion extends Data.TaggedError("NoSuggestion")<{
  readonly reason: string;
}> {}

/** Needs an `HttpClient` whose responses stream. */
const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  return {
    /** The suggestion at `caret` in `text` as it grows: the text so far,
     * each time it changes (empty: none). */
    at: (api: string, path: string, text: string, caret: number, model: Complete.Request["model"]) => {
      const request: Complete.Request = {
        path,
        prefix: text.slice(Math.max(0, caret - PREFIX_CHARS), caret),
        suffix: text.slice(caret, caret + SUFFIX_CHARS),
        ...(model === undefined ? {} : { model }),
      };
      return HttpClientRequest.post(`${api}${Complete.path}`).pipe(
        HttpClientRequest.bodyJsonUnsafe(request),
        http.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.map((response) => response.stream),
        Stream.unwrap,
        Stream.decodeText,
        Stream.pipeThroughChannel(Sse.decode()),
        Stream.mapEffect((event): Effect.Effect<string, NoSuggestion | Schema.SchemaError> =>
          event.event === Complete.errorEvent ? Effect.fail(new NoSuggestion({ reason: event.data })) : decodeResponse(event.data).pipe(Effect.map((response) => response.text)),
        ),
      );
    },
  };
});

export class InlineSuggestions extends Context.Service<InlineSuggestions, Effect.Success<typeof make>>()("@doubleagent/language/InlineSuggestions") {
  static readonly layer = Layer.effect(InlineSuggestions, make);
}
