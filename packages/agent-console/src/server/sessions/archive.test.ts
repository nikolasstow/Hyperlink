import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { SessionArchive } from "./archive";

describe("session archive", () => {
  it("archives, unarchives, mutes and unmutes sessions, kept on disk", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        process.env.AGENT_CONSOLE_STATE_DIR = dir;
        const first = yield* Effect.gen(function* () {
          const archive = yield* SessionArchive;
          yield* archive.archive("ses_a");
          yield* archive.archive("ses_b");
          yield* archive.archive("ses_a");
          yield* archive.mute("ses_b");
          yield* archive.mute("ses_c");
          yield* archive.unmute("ses_c");
          return yield* archive.unarchive("ses_b");
        }).pipe(Effect.provide(Layer.fresh(SessionArchive.layer)));
        // A new server reads what the last one wrote.
        const reread = yield* Effect.gen(function* () {
          const archive = yield* SessionArchive;
          return {
            archived: yield* archive.list,
            muted: yield* archive.muted,
          };
        }).pipe(Effect.provide(Layer.fresh(SessionArchive.layer)));
        delete process.env.AGENT_CONSOLE_STATE_DIR;
        return {
          first,
          reread,
        };
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
    expect(Object.keys(result.first)).toEqual(["ses_a"]);
    expect(result.reread.archived).toEqual(result.first);
    // Muting is its own list: unarchiving b left it muted.
    expect(Object.keys(result.reread.muted)).toEqual(["ses_b"]);
  });
});
