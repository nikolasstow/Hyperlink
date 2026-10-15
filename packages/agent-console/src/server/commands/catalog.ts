/**
 * `GET /commands?directory=…`: the commands and skills opencode has in a
 * folder (the `agent-console-protocol` Commands wire), for the composer's `/`
 * list. The app keeps the list on the device.
 *
 * Only what a row needs goes out: opencode's skill records carry each
 * skill's whole text.
 *
 * @internal
 */
import { Effect, Schema } from "effect";
import { Headers, HttpClient, HttpClientResponse, HttpRouter, HttpServerResponse } from "effect/http";
import { Commands } from "agent-console-protocol";
import { opencodePassword, opencodeUrl, withOpencodeAuth } from "../opencodeServer";

/** What is read of opencode's `GET /api/command`. */
const OpencodeCommands = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.optional(Schema.String),
    }),
  ),
});

/** What is read of opencode's `GET /api/skill` (it carries more: the text). */
const OpencodeSkills = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      description: Schema.optional(Schema.String),
    }),
  ),
});

/** The description, when there is one (the key is left out otherwise). */
const described = (description: string | undefined): Pick<Commands.Entry, "description"> => (description === undefined ? {} : { description });

/** Both lists as one, by name (a skill is named by its id, as opencode's own
 * clients show it). */
const entriesOf = (commands: typeof OpencodeCommands.Type, skills: typeof OpencodeSkills.Type): Commands.Entry[] =>
  [
    ...commands.data.map((command): Commands.Entry => ({
      id: `command:${command.name}`,
      name: command.name,
      ...described(command.description),
      source: "command",
    })),
    ...skills.data.map((skill): Commands.Entry => ({
      id: `skill:${skill.id}`,
      name: skill.id,
      ...described(skill.description),
      source: "skill",
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

export const commandsRoute = HttpRouter.add("GET", Commands.path, (request) =>
  Effect.gen(function* () {
    const directory = new URL(request.originalUrl, "http://localhost").searchParams.get("directory");
    const base = yield* opencodeUrl;
    const password = yield* opencodePassword;
    const http = yield* HttpClient.HttpClient;
    const urlParams = directory === null ? {} : { "location[directory]": directory };
    const read = <S extends Schema.Decoder<unknown>>(path: string, schema: S) =>
      http.get(`${base.replace(/\/+$/, "")}${path}`, { urlParams, headers: withOpencodeAuth(Headers.empty, password) }).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      );
    const [commands, skills] = yield* Effect.all([read("/api/command", OpencodeCommands), read("/api/skill", OpencodeSkills)], { concurrency: "unbounded" });
    return yield* HttpServerResponse.schemaJson(Commands.List)(entriesOf(commands, skills), {
      headers: {
        "cache-control": "no-store",
      },
    });
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("commands: the list could not be read from opencode", error).pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ error: "opencode unreachable" }, { status: 502 })),
      ),
    ),
  ),
);
