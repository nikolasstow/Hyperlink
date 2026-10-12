import { describe, expect, it } from "vitest";
import { isLightTheme, mergeColorsOf, seenOver, transparent } from "./mergeColors";

describe("mergeColors", () => {
  it("makes a colour more transparent the way VS Code does", () => {
    expect(transparent("#40C8AE80", 0.4)).toBe("#40C8AE33");
    expect(transparent("#40A6FF", 0.4)).toBe("#40A6FF66");
    expect(transparent("#abc", 0.5)).toBe("#AABBCC80");
    expect(transparent("red", 0.5)).toBeUndefined();
  });

  it("uses VS Code's defaults where the theme sets nothing", () => {
    expect(mergeColorsOf(undefined)).toEqual({
      currentHeader: "#40C8AE80",
      incomingHeader: "#40A6FF80",
      currentContent: "#40C8AE33",
      incomingContent: "#40A6FF33",
    });
  });

  it("takes the theme's own colours, deriving content from its headers", () => {
    const colors = mergeColorsOf({
      "merge.currentHeaderBackground": "#A6E3A180",
      "merge.incomingContentBackground": "#89B4FA22",
    });
    expect(colors.currentContent).toBe("#A6E3A133");
    expect(colors.incomingContent).toBe("#89B4FA22");
  });

  it("tells a light theme by its type, else by its background", () => {
    expect(isLightTheme("light", "#000000")).toBe(true);
    expect(isLightTheme("dark", "#FFFFFF")).toBe(false);
    expect(isLightTheme(undefined, "#FFFFFF")).toBe(true);
    expect(isLightTheme(undefined, "#FAFBFC")).toBe(true);
    expect(isLightTheme(undefined, "#1E1E1E")).toBe(false);
    expect(isLightTheme(undefined, undefined)).toBe(false);
  });

  it("sees a translucent colour over the editor's background", () => {
    expect(seenOver("#40C8AE80", "#FFFFFF")).toBe("#9FE3D6");
    expect(seenOver("#40C8AE80", "#000000")).toBe("#206457");
    expect(seenOver("#336699", "#FFFFFF")).toBe("#336699");
    expect(seenOver("teal", "#FFFFFF")).toBeUndefined();
  });
});
