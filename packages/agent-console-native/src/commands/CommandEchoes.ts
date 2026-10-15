/**
 * What a command message was typed as. opencode keeps a command's message as
 * the command's prompt (its template filled in), under an id of its own, with
 * nothing marking it as a command (docs/handoffs/slash-commands.md). So when
 * the outbox runs a command, it finds the message the command made and keeps
 * here what was typed (`/name` and its arguments); the chat shows that, with
 * the chip, not the prompt.
 *
 * Kept on the device, the newest few hundred.
 *
 * @internal
 */
import { Context, Effect, Layer, Option, Schema, SubscriptionRef } from "effect";
import * as KeyValueStore from "effect/persistence/KeyValueStore";

const STORE_KEY = "echoes";
/** The most kept (the oldest go first). */
const LIMIT = 500;

export const Echo = Schema.Struct({
  name: Schema.String,
  args: Schema.String,
});
export type Echo = typeof Echo.Type;

/** By message id, oldest first. */
const Echoes = Schema.Record(Schema.String, Echo);
type Echoes = typeof Echoes.Type;

const make = Effect.gen(function* () {
  const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, Echoes);
  const echoes = yield* SubscriptionRef.make<Echoes>({});
  return {
    /** Every echo, as they change. */
    changes: SubscriptionRef.changes(echoes),
    /** Reads back the echoes kept on the device (at launch). */
    readBack: store.get(STORE_KEY).pipe(
      Effect.map(Option.getOrElse((): Echoes => ({}))),
      Effect.flatMap((kept) => SubscriptionRef.set(echoes, kept)),
      Effect.catch((error) => Effect.logError("[commands] the kept echoes could not be read", error)),
    ),
    /** Keeps what message `id` was typed as. */
    record: (id: string, echo: Echo) =>
      SubscriptionRef.updateAndGet(echoes, (all) => {
        const kept: Array<[string, Echo]> = Object.entries(all).filter(([key]) => key !== id);
        kept.push([id, echo]);
        return Object.fromEntries(kept.slice(-LIMIT));
      }).pipe(
        Effect.flatMap((next) => store.set(STORE_KEY, next)),
        Effect.catch((error) => Effect.logError("[commands] keeping an echo failed", error)),
      ),
  };
});

export class CommandEchoes extends Context.Service<CommandEchoes, Effect.Success<typeof make>>()("@doubleagent/commands/CommandEchoes") {
  static readonly layer = Layer.effect(CommandEchoes, make);
}
