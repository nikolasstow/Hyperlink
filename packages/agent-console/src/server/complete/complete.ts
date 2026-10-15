/**
 * `POST /complete`: an inline suggestion at the caret (agent-console-protocol
 * `Complete`; docs/handoffs/code-intelligence.md), as the best editors make
 * one:
 *
 * - **A fill-in-the-middle model** when there is one: the local Qwen2.5-Coder
 *   on llama.cpp's server (`/infill`), given the text either side of the
 *   caret and, as extra context, the chunks of other open files most like the
 *   code at the caret (snippets.ts): they change rarely, so its prompt cache
 *   holds and a keystroke costs only the new text. The chat path also gets
 *   what the language server knows there (language/host.ts `contextAt`). Without one chosen it is used when it
 *   answers; else a chat model through opencode's one-shot generate, told to
 *   reply only `<INSERT>…</INSERT>`.
 * - **Only where one fits** (`fitsAt`), and **shaped** (shape.ts): one line
 *   in the middle of a line, a block on a line of its own.
 *
 * @internal
 */
import { Complete } from "agent-console-protocol";
import { Config, Duration, Effect, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { FileHub } from "../files/hub";
import { LanguageHost, type PlaceContext } from "../language/host";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";
import { isOwnLine, shape } from "./shape";
import { type Snippet, snippetsFor } from "./snippets";

/** The local fill-in-the-middle server (llama.cpp's, with Qwen2.5-Coder). */
const localUrl = Config.String("AGENT_CONSOLE_COMPLETE_URL").pipe(Config.withDefault("http://127.0.0.1:8012"));
/** How long the local server is given to say it is up. */
const HEALTH_WAIT = Duration.millis(300);
/** The most the local model writes: a line, or a block. */
const LINE_TOKENS = 64;
const BLOCK_TOKENS = 192;

const Infilled = Schema.Struct({ content: Schema.String });

/** How long the language server is given for its part of the prompt. */
const CONTEXT_WAIT = Duration.millis(600);

/** What is read of opencode's `GET /api/model`. */
const OpencodeModels = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String, providerID: Schema.String, enabled: Schema.Boolean })) });

const Generated = Schema.Struct({ data: Schema.Struct({ text: Schema.String }) });

/** The prompt: the file's name, then the text either side of the caret. */
export const promptOf = (request: Complete.Request, context: PlaceContext = { names: [] }, snippets: ReadonlyArray<Snippet> = []): string =>
  [
    "You complete code at the cursor, like an editor's inline suggestion.",
    "Reply in exactly this form and nothing else: <INSERT>the text to insert at the cursor</INSERT>",
    "Inside the tags: only code, exactly as it goes in at <CURSOR/>. No explanation, no code fences, nothing already before or after the cursor.",
    "Insert what most likely comes next: finish the line or the statement, or the block if it is plainly unfinished.",
    "If the text after the cursor already completes the line, or nothing fits, reply <INSERT></INSERT>.",
    ...snippets.map((snippet) => `Code from ${snippet.path}, for reference:\n${snippet.text}`),
    `File: ${request.path}`,
    ...(context.signature === undefined ? [] : [`The call at the cursor: ${context.signature}`]),
    ...(context.names.length === 0 ? [] : [`Names valid at the cursor (prefer these): ${context.names.join("; ")}`]),
    `<PREFIX>${request.prefix}</PREFIX><CURSOR/><SUFFIX>${request.suffix}</SUFFIX>`,
  ].join("\n");

/** A chat model's reply as code: what it put between <INSERT> and </INSERT>
 * (nothing without them: then it answered in words), fences it added anyway
 * taken off, ending at any prompt marker it copied. */
export const codeOf = (reply: string): string => {
  const tagged = /<INSERT>([\s\S]*?)<\/INSERT>/.exec(reply);
  if (tagged === null) return "";
  const answer = tagged[1] ?? "";
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(answer.trim());
  const marker = /<\/?(?:CURSOR|PREFIX|SUFFIX)\/?>/.exec(fenced?.[1] ?? answer);
  return (fenced?.[1] ?? answer).slice(0, marker === null ? undefined : marker.index);
};

/** A chat model's reply as text to insert (`codeOf`, without what follows). */
export const insertionOf = (reply: string, suffix: string): string => withoutOverlap(codeOf(reply), suffix);

/** `text` without the start of what already follows the caret, which a model
 * often writes again. */
export const withoutOverlap = (text: string, suffix: string): string => {
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

/** Whether a suggestion fits at the caret: at a line's end, or before only
 * closers (brackets, quotes, `;`, `,`), as VS Code's inline suggestions do.
 * Mid-line, with code after the caret, the line is already written. */
export const fitsAt = (suffix: string): boolean => !/[^\s)\]}"'`;,]/.test(suffix.split("\n", 1)[0] ?? "");

export const completeRoute = HttpRouter.add("POST", Complete.path, (request) =>
  Effect.gen(function* () {
    const asked = yield* HttpServerRequest.schemaBodyJson(Complete.Request);
    if (!fitsAt(asked.suffix)) return yield* HttpServerResponse.schemaJson(Complete.Response)({ text: "" });
    const language = yield* LanguageHost;
    const hub = yield* FileHub;
    const http = yield* HttpClient.HttpClient;
    const ownLine = isOwnLine(asked.prefix, asked.suffix);
    // What the language server knows at the caret, if it answers in time; and
    // the other open files' chunks most like the code at the caret.
    const context = yield* language.contextAt(asked.path, asked.prefix).pipe(Effect.timeoutOrElse({ duration: CONTEXT_WAIT, orElse: () => Effect.succeed<PlaceContext>({ names: [] }) }));
    const snippets = snippetsFor(asked.path, asked.prefix, yield* hub.openFiles);

    // The local model: chosen, or (none chosen) when it is up.
    const local = (yield* localUrl).replace(/\/+$/, "");
    const useLocal =
      asked.model === undefined
        ? yield* http.get(`${local}/health`).pipe(
            Effect.map((response) => response.status === 200),
            Effect.timeoutOrElse({ duration: HEALTH_WAIT, orElse: () => Effect.succeed(false) }),
            Effect.orElseSucceed(() => false),
          )
        : asked.model.providerID === Complete.local.providerID;
    if (useLocal) {
      const response = yield* HttpClientRequest.post(`${local}/infill`).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          input_prefix: asked.prefix,
          input_suffix: asked.suffix,
          // Only what changes rarely: Qwen reads the extra context before the
          // file, so a change there makes it read the whole prompt again (the
          // language server's names change at every caret: the chat path only).
          input_extra: snippets.map((snippet) => ({ filename: snippet.path, text: snippet.text })),
          n_predict: ownLine ? BLOCK_TOKENS : LINE_TOKENS,
          ...(ownLine ? {} : { stop: ["\n"] }),
          // Greedy: the same place gives the same suggestion.
          temperature: 0,
          top_k: 1,
          cache_prompt: true,
        }),
        http.execute,
      );
      if (response.status < 200 || response.status >= 300) {
        const why = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        return yield* Effect.fail(new Error(`the local model answered ${response.status}: ${why.slice(0, 300)}`));
      }
      const infilled = yield* HttpClientResponse.schemaBodyJson(Infilled)(response);
      return yield* HttpServerResponse.schemaJson(Complete.Response)({ text: withoutOverlap(shape(infilled.content, asked.prefix, ownLine), asked.suffix) });
    }

    const base = yield* opencodeUrl;
    const password = yield* opencodePassword;
    // No model asked for: the server's pick (Complete.defaultModel), never
    // opencode's own default (its free tier refuses us).
    const model =
      asked.model ??
      (yield* http.get(`${base.replace(/\/+$/, "")}/api/model`, { headers: withOpencodeAuth(Headers.empty, password) }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(OpencodeModels)),
        Effect.map((models) => {
          const picked = Complete.defaultModel(models.data.filter((each) => each.enabled));
          return picked === undefined ? undefined : { providerID: picked.providerID, id: picked.id };
        }),
      ));
    const response = yield* HttpClientRequest.post(`${base.replace(/\/+$/, "")}/api/experimental/generate`).pipe(
      HttpClientRequest.setHeaders(withOpencodeAuth(Headers.empty, password)),
      HttpClientRequest.bodyJsonUnsafe({ prompt: promptOf(asked, context, snippets), ...(model === undefined ? {} : { model }) }),
      http.execute,
    );
    // opencode's refusal says why (no model, a model it will not run): kept.
    if (response.status < 200 || response.status >= 300) {
      const why = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
      const asking = model === undefined ? "opencode's default model" : `${model.providerID}/${model.id}`;
      return yield* Effect.fail(new Error(`generate answered ${response.status} for ${asking}: ${why.slice(0, 300)}`));
    }
    const generated = yield* HttpClientResponse.schemaBodyJson(Generated)(response);
    return yield* HttpServerResponse.schemaJson(Complete.Response)({ text: withoutOverlap(shape(codeOf(generated.data.text), asked.prefix, ownLine), asked.suffix) });
  }).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    Effect.catch((error) =>
      Effect.logWarning("complete: no suggestion", error).pipe(Effect.as(HttpServerResponse.jsonUnsafe({ error: "no suggestion" }, { status: 502 }))),
    ),
  ),
);
