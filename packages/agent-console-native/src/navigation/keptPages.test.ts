import { describe, expect, it } from "vitest";
import { keptPagesOf, topPage } from "./keptPages";

describe("keptPagesOf", () => {
  it("keeps each page's name and params", () => {
    expect(
      keptPagesOf([
        { name: "Home" },
        { name: "Repo", params: { name: "app", dir: "/r/app", isRepo: true } },
      ]),
    ).toEqual([
      { name: "Home" },
      { name: "Repo", params: { name: "app", dir: "/r/app", isRepo: true } },
    ]);
  });

  it("drops unset params, as JSON does", () => {
    expect(keptPagesOf([{ name: "Files", params: { repo: "app", dir: "/r/app", open: undefined } }])).toEqual([
      { name: "Files", params: { repo: "app", dir: "/r/app" } },
    ]);
  });

  it("stops at a page whose params are not JSON", () => {
    expect(
      keptPagesOf([
        { name: "Home" },
        { name: "Picker", params: { onDone: () => undefined } },
        { name: "Chat", params: { sessionID: "s" } },
      ]),
    ).toEqual([{ name: "Home" }]);
  });
});

describe("topPage", () => {
  it("is the last page, or none", () => {
    expect(topPage([{ name: "Home" }, { name: "Settings" }])?.name).toBe("Settings");
    expect(topPage([])).toBeUndefined();
  });
});
