/**
 * The language server protocol's framing over a byte stream: each message is a
 * `Content-Length: N` header, a blank line, then N bytes of JSON (UTF-8).
 *
 * @internal
 */
import { Effect, Schema, Stream } from "effect";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_END = encoder.encode("\r\n\r\n");

/** A message as framed bytes. */
export const frame = (message: unknown): Uint8Array => {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.length}\r\n\r\n`);
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
};

/** A frame the server sent that cannot be read. */
export class FramingError extends Schema.TaggedError<FramingError>()("FramingError", {
  message: Schema.String,
}) {}

const indexOf = (bytes: Uint8Array, needle: Uint8Array): number => {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
};

/** The whole messages at the front of `buffer`, and what is left over. */
export const unframe = (buffer: Uint8Array): { readonly messages: ReadonlyArray<string>; readonly rest: Uint8Array } | FramingError => {
  const messages: Array<string> = [];
  let rest = buffer;
  for (;;) {
    const end = indexOf(rest, HEADER_END);
    if (end === -1) return { messages, rest };
    const header = decoder.decode(rest.subarray(0, end));
    const length = /content-length:\s*(\d+)/i.exec(header)?.[1];
    if (length === undefined) return new FramingError({ message: `no Content-Length in ${JSON.stringify(header)}` });
    const start = end + HEADER_END.length;
    const stop = start + Number(length);
    if (rest.length < stop) return { messages, rest };
    messages.push(decoder.decode(rest.subarray(start, stop)));
    rest = rest.subarray(stop);
  }
};

/** A byte stream's messages, as JSON text, one each. */
export const messages = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<string, E | FramingError, R> =>
  bytes.pipe(
    Stream.mapAccumEffect(
      () => new Uint8Array(0),
      (buffer, chunk): Effect.Effect<readonly [Uint8Array, ReadonlyArray<string>], FramingError> => {
        const read = unframe(concat(buffer, chunk));
        return read instanceof FramingError ? Effect.fail(read) : Effect.succeed([read.rest, read.messages]);
      },
    ),
  );
