import { describe, expect, it } from "vitest";
import { type BarWindowState, coverOf, maxDragFor, MIN_HEIGHT, type ScreenFrame, stopDragFor, windowTop } from "./barWindowGeometry";

// A concrete iPhone-ish screen; the numbers below are what BarWindow draws
// today (MIN_HEIGHT = 58, fullTop = max(44,59)+8 = 67, resting = max(34-16,6) = 18).
const FRAME: ScreenFrame = { height: 852, headerHeight: 44, insetTop: 59, insetBottom: 34 };
const KB = 336;

const state = (over: Partial<BarWindowState>): BarWindowState => ({ open: true, frac: 0, kbFull: KB, keyboard: 0, ...over });

describe("barWindowGeometry", () => {
  it("pins the pill height", () => {
    expect(MIN_HEIGHT).toBe(58);
  });

  it("maxDragFor shrinks as the keyboard takes room", () => {
    expect(maxDragFor(FRAME, KB)).toBe(383);
    expect(maxDragFor(FRAME, 0)).toBe(701);
  });

  it("stopDragFor is the full range with no stop, else lowers to the stop", () => {
    expect(stopDragFor(383, undefined)).toBe(383);
    expect(stopDragFor(383, 200)).toBe(241);
  });

  it("at full detent, keyboard up, the window top is the full top (67)", () => {
    expect(coverOf(state({ frac: 0, keyboard: KB }), FRAME)).toBe(785);
    expect(windowTop(state({ frac: 0, keyboard: KB }), FRAME)).toBe(67);
  });

  it("at full detent, keyboard down, the window rode down with the bar", () => {
    expect(coverOf(state({ frac: 0, keyboard: 0 }), FRAME)).toBe(785 - (344 - 26));
    expect(windowTop(state({ frac: 0, keyboard: 0 }), FRAME)).toBe(67 + (344 - 26));
  });

  it("at the half detent, keyboard down, covers the pill plus half the range", () => {
    expect(coverOf(state({ frac: 0.5, keyboard: 0 }), FRAME)).toBe(275.5);
  });

  it("at the pill detent, covers just the pill at rest", () => {
    expect(coverOf(state({ frac: 1, keyboard: 0 }), FRAME)).toBe(84);
  });

  it("collapsed covers the pill at rest, whatever the detent was", () => {
    expect(coverOf(state({ open: false, frac: 0, keyboard: 0 }), FRAME)).toBe(84);
  });

  it("with no keyboard ever (kbFull 0), the range is the taller one", () => {
    expect(coverOf(state({ frac: 0, kbFull: 0, keyboard: 0 }), FRAME)).toBe(26 + MIN_HEIGHT + 701);
  });
});
