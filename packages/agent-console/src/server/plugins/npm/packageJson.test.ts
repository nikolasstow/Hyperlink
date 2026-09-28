import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { writeField } from "./packageJson";

const file = ["{", '  "name": "app",', '  "version": "1.0.0",', '  "private": true', "}", ""].join("\n");

const write = (text: string, key: string, value: string | undefined, after: ReadonlyArray<string> = []) => Effect.runPromise(writeField(text, key, value, after));

describe("package.json fields", () => {
  it("changes a field in place", async () => {
    expect(await write(file, "version", "1.1.0")).toBe(file.replace('"1.0.0"', '"1.1.0"'));
  });

  it("adds a field after the one it belongs after", async () => {
    expect(await write(file, "description", 'The "app"', ["version", "name"])).toBe(
      ["{", '  "name": "app",', '  "version": "1.0.0",', '  "description": "The \\"app\\"",', '  "private": true', "}", ""].join("\n"),
    );
  });

  it("removes a field, and the first field too", async () => {
    expect(await write(file, "version", undefined)).toBe(["{", '  "name": "app",', '  "private": true', "}", ""].join("\n"));
    expect(await write(file, "name", undefined)).toBe(["{", '  "version": "1.0.0",', '  "private": true', "}", ""].join("\n"));
  });
});
