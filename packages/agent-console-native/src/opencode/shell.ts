/**
 * Runs one shell command on a server and gives back its output (opencode
 * v2's shell routes): the command starts, is asked after until it exits,
 * its captured output is read page by page, and the record is removed.
 *
 * @internal
 */
import { Data, Effect, Schedule } from "effect";
import { Opencode } from "./Opencode";
import type { ServerAddress } from "./serverAddress";

/** How often a running command is asked after. */
const POLL = "250 millis";

/** The command ran and did not exit cleanly (or could not run). */
export class ShellFailed extends Data.TaggedError("ShellFailed")<{
  readonly command: string;
  readonly status: string;
  readonly exit: number | undefined;
  readonly output: string;
}> {
  override get message(): string {
    const said = this.output.trim();
    return said.length > 0 ? said : `\`${this.command}\` ended: ${this.status}${this.exit === undefined ? "" : ` (${this.exit})`}`;
  }
}

/** Runs `command` in `directory`; its combined output, trimmed. */
export const runShell = (server: ServerAddress, directory: string, command: string) =>
  Effect.gen(function* () {
    const client = yield* (yield* Opencode).client(server);
    const location = { location: { directory } };
    const shell = client["server.shell"];
    const started = yield* shell["shell.create"]({ query: location, payload: { command, cwd: directory } });
    const id = started.data.id;
    return yield* Effect.gen(function* () {
      const ended = yield* shell["shell.get"]({ params: { id }, query: location }).pipe(
        Effect.repeat({ schedule: Schedule.spaced(POLL), until: (info) => info.data.status !== "running" }),
      );
      let output = "";
      let cursor = 0;
      for (;;) {
        const page = yield* shell["shell.output"]({ params: { id }, query: { ...location, cursor } });
        output += page.data.output;
        if (page.data.cursor >= page.data.size || page.data.cursor === cursor) break;
        cursor = page.data.cursor;
      }
      const { status, exit } = ended.data;
      if (status !== "exited" || exit !== 0) return yield* new ShellFailed({ command, status, exit, output });
      return output.trim();
    }).pipe(Effect.ensuring(
        shell["shell.remove"]({ params: { id }, query: location }).pipe(
          Effect.catch((error) => Effect.logWarning(`[shell] removing ${id} failed`, error)),
        ),
      ),);
  });
