/**
 * `POST /complete`: an inline suggestion at the caret (agent-console-protocol
 * `Complete`). A fill-in-the-middle prompt from the text around the caret,
 * answered by one stateless call to opencode's `POST /api/experimental/generate`
 * (no session, no agent), with the model asked for or opencode's default.
 *
 * @internal
 */
import { Complete } from "agent-console-protocol";
import { Effect, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";

const Generated = Schema.Struct({ data: Schema.Struct({ text: Schema.String }) });

/** The prompt: the file's name, then the text either side of the caret. */
export const promptOf = (request: Complete.Request): string =>
  [
    "You complete code at the cursor, like an editor's inline suggestion.",
    "Reply with ONLY the text to insert at <CURSOR/>: no explanation, no code fences, nothing already before or after the cursor.",
    "Insert what most likely comes next: finish the line or the statement, or the block if it is plainly unfinished. Reply with nothing if nothing fits.",
    `File: ${request.path}`,
    `<PREFIX>${request.prefix}</PREFIX><CURSOR/><SUFFIX>${request.suffix}</SUFFIX>`,
  ].join("\n");

/** A model's answer as text to insert: fences a model added anyway taken off,
 * and the text the caret already has after it not repeated. */
export const insertionOf = (answer: string, suffix: string): string => {
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(answer.trim());
  const text = fenced?.[1] ?? answer;
  const rest = suffix.trimStart();
  // The longest start of what follows that the answer ends with (two
  // characters at least: one alone is too likely by chance).
  let overlap = 0;
  for (let length = Math.min(text.length, rest.length, 80); length >= 2; length--) {
    if (text.endsWith(rest.slice(0, length))) {
      overlap = length;
      break;
    }
  }
  const trimmed = text.slice(0, text.length - overlap);
  return trimmed.replace(/\s+$/, (space) => (space.includes("\n") ? "" : space));
};

export const completeRoute = HttpRouter.add("POST", Complete.path, (request) =>
  Effect.gen(function* () {
    const asked = yield* HttpServerRequest.schemaBodyJson(Complete.Request);
    const base = yield* opencodeUrl;
    const password = yield* opencodePassword;
    const http = yield* HttpClient.HttpClient;
    const generated = yield* HttpClientRequest.post(`${base.replace(/\/+$/, "")}/api/experimental/generate`).pipe(
      HttpClientRequest.setHeaders(withOpencodeAuth(Headers.empty, password)),
      HttpClientRequest.bodyJsonUnsafe({ prompt: promptOf(asked), ...(asked.model === undefined ? {} : { model: asked.model }) }),
      http.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Generated)),
    );
    return yield* HttpServerResponse.schemaJson(Complete.Response)({ text: insertionOf(generated.data.text, asked.suffix) });
  }).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    Effect.catch((error) =>
      Effect.logWarning("complete: no suggestion from opencode", error).pipe(Effect.as(HttpServerResponse.jsonUnsafe({ error: "no suggestion" }, { status: 502 }))),
    ),
  ),
);
