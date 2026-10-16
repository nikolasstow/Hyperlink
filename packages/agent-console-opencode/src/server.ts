/**
 * The opencode (v2) plugin that gives agents what the app knows: the
 * problems the editor shows (type errors, lint), from the API server's
 * language servers, never a check of the agent's own. So an agent never sees
 * other problems than the user does.
 *
 * - After `edit`, `write` and `patch`, the problems of each file changed are
 *   added to the tool's result, once the file's check has settled.
 * - The `diagnostics` tool gives one file's problems, or every open file's.
 *
 * Configured in opencode's config (`plugins`: this folder, whose `server.ts` is
 * the entry), with the API server's address
 * and its admin token's file:
 *
 * ```jsonc
 * { "package": "/…/packages/agent-console-opencode/src",
 *   "options": { "apiUrl": "http://127.0.0.1:5199", "tokenFile": "/…/.agent-console/admin-token" } }
 * ```
 *
 * @internal
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Plugin } from "@opencode/plugin/effect";
import { Language } from "agent-console-protocol";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApi, HttpApiClient } from "effect/http-api";

const Options = Schema.Struct({
  /** The API server, as this machine reaches it. */
  apiUrl: Schema.String,
  /** The API server's admin token file (`admin-token` in its state folder). */
  tokenFile: Schema.String,
});

/** The tools that change files, and where each names them. */
const PathInput = Schema.Struct({ path: Schema.String });
const PatchOutput = Schema.Struct({
  applied: Schema.Array(Schema.Struct({ type: Schema.String, resource: Schema.String })),
});
const decodePath = Schema.decodeUnknownOption(PathInput);
const decodePatch = Schema.decodeUnknownOption(PatchOutput);

const DiagnosticsInput = Schema.Struct({
  path: Schema.optionalKey(
    Schema.String.annotate({ description: "The file. Leave it out for every file open in the user's editor." }),
  ),
});

const api = HttpApi.make("agent-console").add(Language.problemsGroup);

/** Text for the agent, as a tool result's content. */
const textContent = (text: string): { readonly type: "text"; readonly text: string } => ({ type: "text", text });

const why = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export default Plugin.define({
  id: "agent-console.problems",
  effect: Effect.fn(function* (ctx) {
    const options = Schema.decodeUnknownOption(Options)(ctx.options);
    if (Option.isNone(options)) {
      return yield* Effect.logError("agent-console.problems: options need `apiUrl` and `tokenFile`; agents get no editor problems");
    }
    const { apiUrl, tokenFile } = options.value;
    const directory = ctx.location.directory;

    /** The problems endpoints, as the admin (token read per call: it may
     * be made after opencode starts). */
    const client = Effect.tryPromise(() => readFile(tokenFile, "utf8")).pipe(
      Effect.flatMap((token) =>
        HttpApiClient.make(api, {
          baseUrl: apiUrl,
          transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(token.trim())),
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    );

    /** A file's problems as the agent reads them; why not, when they can't
     * be had (the agent is told, not left thinking there are none). */
    const problemsOf = (file: string) =>
      client.pipe(
        Effect.flatMap((problems) => problems.problems.file({ payload: { path: file } })),
        Effect.map(Language.problemsText),
        Effect.catch((error) => Effect.succeed(`Couldn't get the editor's problems for ${file}: ${why(error)}`)),
      );

    const openProblems = client.pipe(
      Effect.flatMap((problems) => problems.problems.open()),
      Effect.map((files) => (files.length === 0 ? "No files are open in the editor." : files.map(Language.problemsText).join("\n\n"))),
      Effect.catch((error) => Effect.succeed(`Couldn't get the editor's problems: ${why(error)}`)),
    );

    yield* ctx.tool.hook("execute.after", (event) =>
      Effect.gen(function* () {
        if (event.status !== "completed") return;
        const named: ReadonlyArray<string> =
          event.tool === "edit" || event.tool === "write"
            ? Option.match(decodePath(event.input), { onNone: () => [], onSome: (input) => [input.path] })
            : event.tool === "patch"
              ? Option.match(decodePatch(event.result.output), {
                  onNone: () => [],
                  onSome: (output) => output.applied.filter((item) => item.type !== "delete").map((item) => item.resource),
                })
              : [];
        const files = named.map((file) => resolve(directory, file)).filter((file) => Language.languageOf(file) !== undefined);
        if (files.length === 0) return;
        const texts = yield* Effect.forEach(files, problemsOf, { concurrency: "unbounded" });
        const content = event.result.content;
        const before = content === undefined ? [] : typeof content === "string" ? [textContent(content)] : content;
        event.result = { ...event.result, content: [...before, ...texts.map(textContent)] };
      }),
    );

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "diagnostics",
        description: [
          "The problems (type errors, lint) the user's editor shows, from the same language servers, for the text as it is now.",
          "Use this, not your own tsc or eslint run, to see what the user sees.",
          "Give `path` for one file (waits for its check to settle after your edits); leave it out for every file open in the editor.",
          "Edits (edit, write, patch) already add the problems of the files they change to their result.",
        ].join(" "),
        input: DiagnosticsInput,
        options: { codemode: false, permission: "read" },
        execute: (input) => (input.path === undefined ? openProblems : problemsOf(resolve(directory, input.path))).pipe(Effect.map((text) => ({ content: text }))),
      }),
    );
  }),
});
