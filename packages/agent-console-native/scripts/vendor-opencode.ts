/**
 * Copies the part of opencode's v2 API the app uses into `src/opencode`, from
 * an opencode checkout at the server's version: the `HttpApi` groups it calls
 * (`@opencode-ai/protocol`: health, sessions, messages, events) into
 * `src/opencode/protocol`; the projection of session events into messages
 * (`@opencode-ai/core`'s message updater, so the app folds events exactly as
 * the server does) into `src/opencode/core`; and every `@opencode-ai/schema`
 * module these reach into `src/opencode/schema`. None of these packages is
 * published, so this is how the app gets the server's exact API (an
 * `HttpApiClient` is derived from it), wire shapes and projection.
 *
 *   pnpm vendor:opencode                       # ~/Coding/opencode at v1.18.33
 *   pnpm vendor:opencode --repo <dir> --ref <tag>
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { runString } from "./command";

/** The protocol modules the app uses (paths under protocol's `src`). */
const PROTOCOL = [
  "errors.ts",
  "middleware/authorization.ts",
  "middleware/schema-error.ts",
  "groups/health.ts",
  "groups/session.ts",
  "groups/message.ts",
  "groups/event.ts",
];

/** The core modules the app uses (paths under core's `src`), with how their
 * imports of core's re-exports of schema are pointed at the vendored schema. */
const CORE = ["session/message-updater.ts"];
const CORE_IMPORTS: ReadonlyArray<readonly [string, string]> = [
  ['from "./event"', 'from "../schema/session-event"'],
  ['from "./message"', 'from "../schema/session-message"'],
];

/** The schema modules a module imports, as paths under schema's `src`:
 * relative imports resolved against the module's own folder (within schema),
 * and `@opencode-ai/schema/x` (from protocol). */
const schemaImportsOf = (path: Path.Path, file: string, source: string, fromProtocol: boolean): ReadonlyArray<string> =>
  Array.from(source.matchAll(/from "([^"]+)"/g), (match) => match[1] ?? "").flatMap((specifier) => {
    if (specifier.startsWith("@opencode-ai/schema/")) return [`${specifier.slice("@opencode-ai/schema/".length)}.ts`];
    if (fromProtocol || !specifier.startsWith(".")) return [];
    return [`${path.normalize(path.join(path.dirname(file), specifier))}.ts`];
  });

/** Protocol's `@opencode-ai/schema/x` imports, pointed at the vendored copy
 * (`depth` = how far the module sits below `src/opencode/protocol`). */
const rewriteSchemaImports = (source: string, depth: number): string =>
  source.replaceAll("from \"@opencode-ai/schema/", `from "${"../".repeat(depth + 1)}schema/`);

const vendor = Command.make("vendor-opencode", {
  repo: Flag.string("repo").pipe(Flag.withDefault(`${process.env.HOME}/Coding/opencode`), Flag.withDescription("An opencode checkout.")),
  ref: Flag.string("ref").pipe(Flag.withDefault("v1.18.33"), Flag.withDescription("The server's version (a git ref).")),
}).pipe(
  Command.withDescription("Vendor the opencode v2 API the app uses (protocol groups and their schema) into src/opencode."),
  Command.withHandler(({ repo, ref }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(import.meta.dirname, "../src/opencode");
      const show = (file: string) =>
        runString({
          command: "git",
          args: ["-C", repo, "show", `${ref}:packages/${file}`],
          cwd: repo,
        });

      const protocol = new Map<string, string>();
      for (const file of PROTOCOL) protocol.set(file, yield* show(`protocol/src/${file}`));
      const core = new Map<string, string>();
      for (const file of CORE) {
        const source = yield* show(`core/src/${file}`);
        core.set(path.basename(file), CORE_IMPORTS.reduce((text, [from, to]) => text.replaceAll(from, to), source));
      }

      // Walk the schema imports from the protocol modules: every schema module
      // reached is copied.
      const schema = new Map<string, string>();
      const pending = [
        ...Array.from(protocol, ([file, source]) => schemaImportsOf(path, file, source, true)).flat(),
        ...Array.from(core.values(), (source) => Array.from(source.matchAll(/from "\.\.\/schema\/([^"]+)"/g), (match) => `${match[1]}.ts`)).flat(),
      ];
      for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (schema.has(file)) continue;
        const source = yield* show(`schema/src/${file}`);
        schema.set(file, source);
        pending.push(...schemaImportsOf(path, file, source, false));
      }

      const commit = yield* runString({
        command: "git",
        args: ["-C", repo, "rev-parse", "--short", `${ref}^{commit}`],
        cwd: repo,
      });
      const write = (dir: string, files: ReadonlyMap<string, string>, transform: (file: string, source: string) => string) =>
        Effect.gen(function* () {
          yield* fs.remove(dir, { recursive: true }).pipe(Effect.ignore);
          yield* Effect.forEach(
            files,
            ([file, source]) =>
              Effect.gen(function* () {
                const target = path.join(dir, file);
                yield* fs.makeDirectory(path.dirname(target), { recursive: true });
                yield* fs.writeFileString(target, `${transform(file, source)}\n`);
              }),
            { discard: true },
          );
          yield* fs.writeFileString(path.join(dir, "VERSION"), `opencode ${ref} (${commit})\n`);
        });
      yield* write(path.join(root, "schema"), schema, (_, source) => source);
      yield* write(path.join(root, "protocol"), protocol, (file, source) => rewriteSchemaImports(source, file.split("/").length - 1));
      yield* write(path.join(root, "core"), core, (_, source) => source);
      yield* Effect.log(`Vendored ${protocol.size} protocol, ${core.size} core and ${schema.size} schema modules from opencode ${ref} into src/opencode.`);
    }),
  ),
);

Command.run(vendor, { version: packageJson.version }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
