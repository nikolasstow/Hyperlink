import { describe, expect, it } from "vitest";
import { changeColorsOf } from "./changeColors";

describe("changeColors", () => {
  it("uses VS Code's defaults where the theme sets nothing, dark or light", () => {
    expect(changeColorsOf(undefined, false)).toEqual({
      added: "#487E02",
      modified: "#1B81A8",
      deleted: "#F14C4C",
      flash: "#9BB95533",
    });
    expect(changeColorsOf(undefined, true)).toEqual({
      added: "#48985D",
      modified: "#2090D3",
      deleted: "#E51400",
      flash: "#9BB95533",
    });
  });

  it("takes the theme's own colours", () => {
    expect(
      changeColorsOf(
        {
          "editorGutter.addedBackground": "#A6E3A1",
          "editorGutter.modifiedBackground": "#89B4FA",
          "editorGutter.deletedBackground": "#F38BA8",
          "diffEditor.insertedLineBackground": "#A6E3A126",
        },
        false,
      ),
    ).toEqual({
      added: "#A6E3A1",
      modified: "#89B4FA",
      deleted: "#F38BA8",
      flash: "#A6E3A126",
    });
  });

  it("falls back to the theme's error colour for deletions and its inserted-text colour for the flash", () => {
    const colors = changeColorsOf(
      {
        "editorError.foreground": "#FF0000",
        "diffEditor.insertedTextBackground": "#00FF0033",
      },
      true,
    );
    expect(colors.deleted).toBe("#FF0000");
    expect(colors.flash).toBe("#00FF0033");
  });
});
