import { describe, expect, it, vi } from "vitest";
import { carriedOverAddress, codeFontSizeOf, DEFAULT_CODE_FONT_SIZE, deriveBackendAddress, opencodeAddressOf, parseTheme, stepCodeFontSize } from "./settings";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {},
}));

describe("server address", () => {
  it("carries a saved opencode address over to the API server on the same host", () => {
    expect(carriedOverAddress("100.67.32.32:4096")).toBe("http://100.67.32.32:5199");
    expect(carriedOverAddress("http://mac.local:4096/")).toBe("http://mac.local:5199");
  });

  it("keeps an address typed some other way", () => {
    expect(carriedOverAddress("100.67.32.32:5299")).toBe("100.67.32.32:5299");
    expect(carriedOverAddress("not an address")).toBe("not an address");
  });

  it("reaches opencode under the server, and the backend on the same host", () => {
    expect(opencodeAddressOf("100.67.32.32:5199")).toBe("http://100.67.32.32:5199/opencode");
    expect(opencodeAddressOf("http://100.67.32.32:5199/")).toBe("http://100.67.32.32:5199/opencode");
    expect(deriveBackendAddress("100.67.32.32:5199")).toBe("http://100.67.32.32:5195");
  });
});

describe("code font size", () => {
  it("defaults when the theme sets none, and keeps one it does", () => {
    const plain = parseTheme({ primary: "#000000", secondary: "#FFFFFF" });
    expect(plain === undefined ? undefined : codeFontSizeOf(plain)).toBe(DEFAULT_CODE_FONT_SIZE);
    const sized = parseTheme({ primary: "#000000", secondary: "#FFFFFF", codeFontSize: 15 });
    expect(sized === undefined ? undefined : codeFontSizeOf(sized)).toBe(15);
  });

  it("steps a point at a time within its range", () => {
    expect(stepCodeFontSize(12.5, 1)).toBe(13.5);
    expect(stepCodeFontSize(12.5, -1)).toBe(11.5);
    expect(stepCodeFontSize(8.5, -1)).toBe(8.5);
    expect(stepCodeFontSize(24.5, 1)).toBe(24.5);
  });
});
