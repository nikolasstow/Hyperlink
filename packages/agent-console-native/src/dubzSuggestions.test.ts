import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { DubzContextEntry, suggestionsFor, type DubzContext } from "./dubzSuggestions";

const decode = Schema.decodeUnknownSync(DubzContextEntry);

describe("DubzContextEntry schema", () => {
  it("decodes an editable document, carrying its tag, file, and instructions", () => {
    const entry = decode({
      _tag: "EditableDocument",
      id: "pkg",
      file: { repo: "app", path: "/app/package.json", name: "package.json", kind: "file" },
      instructions: "keep valid JSON",
    });
    expect(entry._tag).toBe("EditableDocument");
    expect(entry.file.path).toBe("/app/package.json");
  });

  it("round-trips through its JSON codec", () => {
    const value = { _tag: "ReferenceDocument", id: "r", file: { repo: "app", path: "/a/x.ts", name: "x.ts", kind: "file" } } as const;
    expect(Schema.encodeUnknownSync(DubzContextEntry)(decode(value))).toEqual(value);
  });

  it("rejects an unknown tag, so a resolver can skip entries it does not understand", () => {
    expect(() => decode({ _tag: "SomethingNewer", id: "x", file: { repo: "a", path: "/a", name: "a", kind: "file" } })).toThrow();
  });
});

describe("suggestionsFor", () => {
  const ctx = (scope: DubzContext["scope"]): DubzContext => ({ surface: "repo", scope });

  it("offers the repo's tasks on a repo, a chosen repo on All, and nothing on a plain folder", () => {
    expect(suggestionsFor(ctx({ _tag: "Repo", repo: "app" }))).toEqual([{ _tag: "Tasks", repo: "app" }]);
    expect(suggestionsFor(ctx({ _tag: "All" }))).toEqual([{ _tag: "Tasks", repo: undefined }]);
    expect(suggestionsFor(ctx({ _tag: "Folder" }))).toEqual([]);
  });

  it("shows just the session row when the page publishes an editable document", () => {
    const file = { repo: "app", path: "/app/package.json", name: "package.json", kind: "file" } as const;
    expect(
      suggestionsFor({
        surface: "repo",
        scope: { _tag: "Repo", repo: "app" },
        entries: [{ _tag: "EditableDocument", id: "pkg", file }],
      }),
    ).toEqual([{ _tag: "Sessions", file }]);
  });
});
