import { describe, expect, it } from "vitest";
import { entryOf, formatBytes, outcomeText } from "./httpFileSource";
import { flattenRows } from "./sourceRows";

describe("flattenRows", () => {
  const file = (path: string) => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "file" as const });
  const folder = (path: string) => ({ path, name: path.split("/").filter((part) => part !== "").pop() ?? path, kind: "directory" as const });

  it("lists the root's entries, and the entries of each open folder under it, deeper", () => {
    const state = {
      children: new Map([
        ["/local/", [folder("/local/old/"), file("/local/a.goo")]],
        ["/local/old/", [file("/local/old/b.goo")]],
      ]),
      expanded: new Set(["/local/old/"]),
      loading: new Set<string>(),
      failed: new Set<string>(),
    };
    expect(flattenRows(state, "/local/").map((row) => [row.path, row.depth, row.expanded])).toEqual([
      ["/local/old/", 0, true],
      ["/local/old/b.goo", 1, false],
      ["/local/a.goo", 0, false],
    ]);
    expect(flattenRows({ ...state, expanded: new Set() }, "/local/").map((row) => row.path)).toEqual(["/local/old/", "/local/a.goo"]);
  });
});

describe("httpFileSource", () => {
  it("shows a printer file's size, last print, preview, and that it is printing", () => {
    const now = Date.now();
    const row = entryOf("http://relay:5197", {
      name: "base 1.goo",
      path: "/local/base 1.goo",
      kind: "file",
      size: 465_104_419,
      printing: true,
      lastPrint: { at: now - 3 * 3_600_000, outcome: "failed", reason: "Foreign object found" },
    });
    expect(row).toEqual({
      path: "/local/base 1.goo",
      name: "base 1.goo",
      kind: "file",
      detail: "444 MB · Failed 3h ago",
      thumbnail: "http://relay:5197/api/files/preview.png?path=%2Flocal%2Fbase%201.goo",
      badge: "Printing",
    });
  });

  it("names folders with a trailing slash and gives them no detail or preview", () => {
    expect(entryOf("http://relay:5197", { name: "old", path: "/local/old", kind: "folder" })).toEqual({ path: "/local/old/", name: "old", kind: "directory" });
  });

  it("says how a print ended, with the printer's reason", () => {
    expect(outcomeText("completed", undefined)).toBe("Printed");
    expect(outcomeText("failed", "Foreign object found")).toBe("Failed: Foreign object found");
    expect(outcomeText("stopped", undefined)).toBe("Stopped");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});
