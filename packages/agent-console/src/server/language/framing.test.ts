import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { frame, messages } from "./framing";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("framing", () => {
  it("reads messages split anywhere across chunks, multi-byte text included", async () => {
    const all = new Uint8Array([...frame({ id: 1, text: "héllo ✓" }), ...frame({ method: "x" })]);
    const chunks = [all.subarray(0, 5), all.subarray(5, 23), all.subarray(23, 40), all.subarray(40)];
    const read = await Effect.runPromise(Stream.runCollect(messages(Stream.fromIterable(chunks))));
    expect(read.map((text) => JSON.parse(text))).toEqual([{ id: 1, text: "héllo ✓" }, { method: "x" }]);
  });

  it("counts Content-Length in bytes", () => {
    expect(new TextDecoder().decode(frame({ a: "é" })).startsWith(`Content-Length: ${bytes('{"a":"é"}').length}\r\n\r\n`)).toBe(true);
  });

  it("fails on a header without a length", async () => {
    const result = await Effect.runPromise(Stream.runCollect(messages(Stream.make(bytes("Bad: 1\r\n\r\n{}")))).pipe(Effect.flip));
    expect(result._tag).toBe("FramingError");
  });
});
