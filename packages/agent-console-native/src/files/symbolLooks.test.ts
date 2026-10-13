import { describe, expect, it } from "vitest";
import { crumbColorOf, symbolLookOf } from "./symbolLooks";

describe("symbolLooks", () => {
  it("uses VS Code's defaults where the theme sets nothing", () => {
    expect(symbolLookOf("function", undefined, "fg").color).toBe("#B180D7");
    expect(symbolLookOf("class", undefined, "fg").color).toBe("#EE9D28");
    expect(symbolLookOf("variable", undefined, "fg").color).toBe("#75BEFF");
  });

  it("draws the kinds VS Code leaves in the text colour in the theme's foreground", () => {
    expect(symbolLookOf("constant", { foreground: "#CCCCCC" }, "fg").color).toBe("#CCCCCC");
    expect(symbolLookOf("constant", undefined, "fg").color).toBe("fg");
  });

  it("takes the theme's own symbol colours", () => {
    expect(symbolLookOf("method", { "symbolIcon.methodForeground": "#FF00FF" }, "fg").color).toBe("#FF00FF");
  });

  it("colours the crumbs from breadcrumb.foreground, then foreground", () => {
    expect(crumbColorOf({ "breadcrumb.foreground": "#AAAAAA", foreground: "#CCCCCC" }, "fg")).toBe("#AAAAAA");
    expect(crumbColorOf({ foreground: "#CCCCCC" }, "fg")).toBe("#CCCCCC");
    expect(crumbColorOf(undefined, "fg")).toBe("fg");
  });
});
