/**
 * Binary encode/decode for {@link EventJournal} store row payloads, with
 * Effect's {@link SchemaBinary} codec over JSON values (Effect 4.0 removed its
 * MessagePack codec). The journal is in memory, so no stored bytes depend on
 * the format.
 *
 * @module internal/store/journalCodec
 * @internal
 */

import { Effect, Schema } from "effect";
import { SchemaBinary } from "effect/encoding";
import { toJsonValue } from "./helpers";
import { StoreJournalDecodeError, StoreJournalEncodeError } from "./errors";

const journalPayloadBytes = SchemaBinary.toCodec(Schema.Json);

/** @internal */
export const encodeJournalPayload = (
  payload: unknown,
): Effect.Effect<Uint8Array<ArrayBuffer>, StoreJournalEncodeError> =>
  Schema.encodeUnknownEffect(journalPayloadBytes)(toJsonValue(payload)).pipe(
    // Encoded bytes may share a larger buffer; the journal keeps each payload.
    Effect.map((bytes) => bytes.slice()),
    Effect.mapError(
      (cause) =>
        new StoreJournalEncodeError({
          cause,
          detail: "Failed to encode store row payload",
        }),
    ),
  );

/** @internal */
export const decodeJournalPayload = (
  bytes: Uint8Array,
): Effect.Effect<unknown, StoreJournalDecodeError> =>
  Schema.decodeUnknownEffect(journalPayloadBytes)(bytes).pipe(
    Effect.mapError(
      (cause) =>
        new StoreJournalDecodeError({
          cause,
          detail: "Failed to decode store row payload",
        }),
    ),
  );
