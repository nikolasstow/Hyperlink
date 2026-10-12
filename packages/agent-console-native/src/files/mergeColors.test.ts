import { describe, expect, it } from "vitest";
import { mergeColorsOf, transparent } from "./mergeColors";

describe("mergeColors", () => {
  it("makes a colour more transparent the way VS Code does", () => {
    expect(transparent("#40C8AE80", 0.4)).toBe("#40C8AE33");
    expect(transparent("#40A6FF", 0.4)).toBe("#40A6FF66");
    expect(transparent("#abc", 0.5)).toBe("#AABBCC80");
    expect(transparent("red", 0.5)).toBeUndefined();
  });

  it("uses VS Code's defaults where the theme sets nothing", () => {
    expect(mergeColorsOf(undefined, false)).toEqual({
      currentHeader: "#40C8AE80",
      incomingHeader: "#40A6FF80",
      currentContent: "#40C8AE33",
      incomingContent: "#40A6FF33",
      widgetBackground: "#252526",
      widgetBorder: "#454545",
      label: "#BBBBBB",
    });
    expect(mergeColorsOf(undefined, true).widgetBackground).toBe("#F3F3F3");
  });

  it("takes the theme's own colours, deriving content from its headers", () => {
    const colors = mergeColorsOf(
      {
        "merge.currentHeaderBackground": "#A6E3A180",
        "merge.incomingContentBackground": "#89B4FA22",
        "editorWidget.background": "#181825",
        "editor.foreground": "#CDD6F4",
      },
      false,
    );
    expect(colors.currentHeader).toBe("#A6E3A180");
    expect(colors.currentContent).toBe("#A6E3A133");
    expect(colors.incomingContent).toBe("#89B4FA22");
    expect(colors.widgetBackground).toBe("#181825");
    expect(colors.label).toBe("#CDD6F4");
  });
});
