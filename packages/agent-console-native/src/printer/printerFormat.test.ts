import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration, healthItems, isPrintableName, settingsCells } from "./printerFormat";
import type { PrintHeader } from "./relayApi";

const header: PrintHeader = {
  displayWidthMm: 211.68,
  displayHeightMm: 118.37,
  layerHeightMm: 0.02,
  layerCount: 5032,
  exposureSeconds: 1.8,
  bottomExposureSeconds: 32,
  bottomLayerCount: 5,
  transitionLayerCount: 10,
  antiAliasing: 4,
  volumeMl: 121.4994,
  materialGrams: 121.507,
  printSeconds: 35826,
  softwareName: "UVtools",
  softwareVersion: "7.0.2",
  createdAt: "2026-10-18 00:44:57",
};

describe("printer formatting", () => {
  it("formats durations and sizes", () => {
    expect(fmtDuration(9 * 3600_000 + 57 * 60_000)).toBe("9h 57m");
    expect(fmtDuration(65_000)).toBe("1m 05s");
    expect(fmtDuration(undefined)).toBe("—");
    expect(fmtBytes(486_786_283)).toBe("486.8 MB");
    expect(fmtBytes(1_083_572_224)).toBe("1.08 GB");
    expect(fmtBytes(undefined)).toBe("");
  });

  it("knows which files the printer prints", () => {
    expect(isPrintableName("base 9.goo")).toBe(true);
    expect(isPrintableName("part.CTB")).toBe(true);
    expect(isPrintableName("notes.txt")).toBe(false);
  });

  it("lists a print file's settings", () => {
    const cells = settingsCells(header);
    expect(cells.find((c) => c.label === "Layer height")?.value).toBe("20 µm");
    expect(cells.find((c) => c.label === "Layers")?.value).toBe("5,032 · 100.6 mm");
    expect(cells.find((c) => c.label === "Bottom")?.value).toBe("32 s × 5");
    expect(cells.find((c) => c.label === "Resin")?.value).toBe("121.5 ml · 122 g");
    expect(cells.find((c) => c.label === "Sliced with")).toMatchObject({ value: "UVtools 7.0.2", wide: true });
  });

  it("reads the self-check, flagging anything but 1", () => {
    const items = healthItems({ LCDStatus: 1, RelaseFilmState: 0, SgStatus: 2, Unknown: 1 });
    expect(items).toEqual([
      { label: "LCD screen", ok: true },
      { label: "Force sensor", ok: false },
      { label: "Release film", ok: false },
    ]);
    expect(healthItems(undefined)).toEqual([]);
  });
});
