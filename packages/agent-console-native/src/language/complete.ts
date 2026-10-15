/**
 * An inline suggestion from the API server (`POST /complete`,
 * agent-console-protocol `Complete`): what to insert at the caret.
 *
 * @internal
 */
import { Complete } from "agent-console-protocol";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

/** How much of the text either side of the caret goes with the request. */
const PREFIX_CHARS = 4000;
const SUFFIX_CHARS = 1500;

/** The suggestion at `caret` in `text` (empty: none). */
export const completeAt = (api: string, path: string, text: string, caret: number, model: Complete.Request["model"]) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const request: Complete.Request = {
      path,
      prefix: text.slice(Math.max(0, caret - PREFIX_CHARS), caret),
      suffix: text.slice(caret, caret + SUFFIX_CHARS),
      ...(model === undefined ? {} : { model }),
    };
    const response = yield* HttpClientRequest.post(`${api}${Complete.path}`).pipe(
      HttpClientRequest.bodyJsonUnsafe(request),
      http.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Complete.Response)),
    );
    return response.text;
  });
