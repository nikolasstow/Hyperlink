/**
 * Copies the part of opencode's `@opencode-ai/schema` the app needs (sessions,
 * messages, events, prompt inputs, and everything they import) into
 * `src/opencode/schema`, from an opencode checkout at the server's version.
 * The package is not published, so this is how the app gets the exact wire
 * shapes of the server it talks to.
 *
 *   pnpm vendor:opencode-schema                       # ~/Coding/opencode at v1.18.33
 *   pnpm vendor:opencode-schema --repo <dir> --ref <tag>
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import packageJson from "../package.json" with { type: "json" };
import { runString } from "./command";

/** The modules the app uses; their imports come along. */
const ROOTS = [
  "session.ts",
  "session-message.ts",
  "session-event.ts",
  "session-input.ts",
  "prompt-input.ts",
  "session-status-event.ts",
  "session-delivery.ts",
];

const SOURCE = "packages/schema/src";

/** The relative imports of a module (`./x` → `x.ts`). */
const importsOf = (source: string): ReadonlyArray<string> =>
  Array.from(source.matchAll(/from "\.\/([^"]+)"/g), (match) => `${match[1]}.ts`);

const vendor = Command.make("vendor-opencode-schema", {
  repo: Flag.string("repo").pipe(Flag.withDefault(`${process.env.HOME}/Coding/opencode`), Flag.withDescription("An opencode checkout.")),
  ref: Flag.string("ref").pipe(Flag.withDefault("v1.18.33"), Flag.withDescription("The server's version (a git ref).")),
}).pipe(
  Command.withDescription("Vendor opencode's schema closure into src/opencode/schema."),
  Command.withHandler(({ repo, ref }) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const out = path.resolve(import.meta.dirname, "../src/opencode/schema");
      const show = (file: string) =>
        runString({
          command: "git",
          args: ["-C", repo, "show", `${ref}:${SOURCE}/${file}`],
          cwd: repo,
        });

      // Walk the imports from the roots: every module reached is copied.
      const files = new Map<string, string>();
      const pending = [...ROOTS];
      for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
        if (files.has(file)) continue;
        const source = yield* show(file);
        files.set(file, source);
        pending.push(...importsOf(source));
      }

      const commit = yield* runString({
        command: "git",
        args: ["-C", repo, "rev-parse", "--short", `${ref}^{commit}`],
        cwd: repo,
      });
      yield* fs.remove(out, { recursive: true }).pipe(Effect.ignore);
      yield* fs.makeDirectory(out, { recursive: true });
      yield* Effect.forEach(files, ([file, source]) => fs.writeFileString(path.join(out, file), `${source}\n`), { discard: true });
      yield* fs.writeFileString(path.join(out, "VERSION"), `opencode ${ref} (${commit})\n`);
      yield* Effect.log(`Vendored ${files.size} modules from opencode ${ref} into src/opencode/schema.`);
    }),
  ),
);

Command.run(vendor, { version: packageJson.version }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
