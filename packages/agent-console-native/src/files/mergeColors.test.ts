import { describe, expect, it } from "vitest";
import { isLightTheme, mergeColorsOf, transparent } from "./mergeColors";

describe("mergeColors", () => {
  it("makes a colour more transparent the way VS Code does", () => {
    expect(transparent("#40C8AE80", 0.4)).toBe("#40C8AE33");
    expect(transparent("#40A6FF", 0.4)).toBe("#40A6FF66");
    expect(transparent("#abc", 0.5)).toBe("#AABBCC80");
    expect(transparent("red", 0.5)).toBeUndefined();
  });

  it("uses VS Code's defaults where the theme sets nothing", () => {
    expect(mergeColorsOf(undefined, undefined, false)).toEqual({
      currentHeader: "#40C8AE80",
      incomingHeader: "#40A6FF80",
      currentContent: "#40C8AE33",
      incomingContent: "#40A6FF33",
      label: "#BBBBBB",
    });
    expect(mergeColorsOf(undefined, undefined, true).label).toBe("#333333");
  });

  it("takes the theme's own colours, deriving content from its headers", () => {
    const colors = mergeColorsOf(
      {
        "merge.currentHeaderBackground": "#A6E3A180",
        "merge.incomingContentBackground": "#89B4FA22",
      },
      "#24292E",
      true,
    );
    expect(colors.currentContent).toBe("#A6E3A133");
    expect(colors.incomingContent).toBe("#89B4FA22");
    expect(colors.label).toBe("#24292E");
  });

  it("tells a light theme by its type, else by its background", () => {
    expect(isLightTheme("light", "#000000")).toBe(true);
    expect(isLightTheme("dark", "#FFFFFF")).toBe(false);
    expect(isLightTheme(undefined, "#FFFFFF")).toBe(true);
    expect(isLightTheme(undefined, "#FAFBFC")).toBe(true);
    expect(isLightTheme(undefined, "#1E1E1E")).toBe(false);
    expect(isLightTheme(undefined, undefined)).toBe(false);
  });
});
