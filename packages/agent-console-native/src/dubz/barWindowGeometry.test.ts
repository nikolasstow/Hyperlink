import { describe, expect, it } from "vitest";
import { type BarWindowState, clampRequested, coverOf, maxHeightFor, MIN_HEIGHT, type ScreenFrame, sameBarWindowState, snapOpenHeight, windowTop } from "./barWindowGeometry";

// A concrete iPhone-ish screen; the numbers below are what the window draws
// (MIN_HEIGHT = 58, fullTop = max(44,59)+8 = 67, resting = max(34-16,6) = 18,
// windowBottom = max(keyboard, 18) + 8).
const FRAME: ScreenFrame = { height: 852, headerHeight: 44, insetTop: 59, insetBottom: 34 };
const KB = 336;

const state = (over: Partial<BarWindowState>): BarWindowState => ({ open: true, height: MIN_HEIGHT, keyboard: 0, ...over });

describe("barWindowGeometry", () => {
  it("pins the pill height", () => {
    expect(MIN_HEIGHT).toBe(58);
  });

  it("maxHeightFor shrinks as the keyboard takes room", () => {
    expect(maxHeightFor(FRAME, KB)).toBe(441);
    expect(maxHeightFor(FRAME, 0)).toBe(759);
  });

  it("the keyboard moves the clamp, never the requested height", () => {
    // A request that fits under both: the same visible height, keyboard up or down.
    expect(clampRequested(300, FRAME, 0)).toBe(300);
    expect(clampRequested(300, FRAME, KB)).toBe(300);
    // A tall request: full when the keyboard is down, clamped when it is up —
    // the clamp accounts for the difference, the window stays above the keyboard.
    expect(clampRequested(1000, FRAME, 0)).toBe(759);
    expect(clampRequested(1000, FRAME, KB)).toBe(441);
    // Never below the pill.
    expect(clampRequested(10, FRAME, 0)).toBe(MIN_HEIGHT);
  });

  it("snapOpenHeight has two low anchors then rests free above minOpen (Dubz)", () => {
    const minOpen = 134;
    const max = 759;
    // Below minOpen: nearer of the pill (58) and minOpen (134); mid = 96.
    expect(snapOpenHeight(80, 80, minOpen, max, true)).toBe(MIN_HEIGHT);
    expect(snapOpenHeight(120, 120, minOpen, max, true)).toBe(minOpen);
    // At or above minOpen: free, where released, capped at max.
    expect(snapOpenHeight(300, 300, minOpen, max, true)).toBe(300);
    expect(snapOpenHeight(1000, 1000, minOpen, max, true)).toBe(max);
  });

  it("snapOpenHeight snaps to the nearer of the two anchors (model picker)", () => {
    const minOpen = 300;
    const max = 759;
    const mid = (minOpen + max) / 2; // 529.5
    expect(snapOpenHeight(400, 400, minOpen, max, false)).toBe(minOpen);
    expect(snapOpenHeight(600, 600, minOpen, max, false)).toBe(max);
    // Momentum carries it over the midpoint.
    expect(snapOpenHeight(500, mid + 1, minOpen, max, false)).toBe(max);
  });

  it("at full height the window top is the full top (67), keyboard up or down", () => {
    expect(coverOf(state({ height: 441, keyboard: KB }), FRAME)).toBe(785);
    expect(windowTop(state({ height: 441, keyboard: KB }), FRAME)).toBe(67);
    expect(coverOf(state({ height: 759, keyboard: 0 }), FRAME)).toBe(785);
    expect(windowTop(state({ height: 759, keyboard: 0 }), FRAME)).toBe(67);
  });

  it("a mid height covers its height over the window's bottom", () => {
    expect(coverOf(state({ height: 300, keyboard: 0 }), FRAME)).toBe(26 + 300);
    expect(coverOf(state({ height: 300, keyboard: KB }), FRAME)).toBe(344 + 300);
  });

  it("collapsed covers just the pill at rest, whatever the height was", () => {
    expect(coverOf(state({ open: false, height: 500, keyboard: 0 }), FRAME)).toBe(84);
    expect(coverOf(state({ open: false, height: 500, keyboard: KB }), FRAME)).toBe(344 + MIN_HEIGHT);
  });

  it("sameBarWindowState compares the settled fields", () => {
    expect(sameBarWindowState(state({ height: 300 }), state({ height: 300 }))).toBe(true);
    expect(sameBarWindowState(state({ height: 300 }), state({ height: 301 }))).toBe(false);
    expect(sameBarWindowState(state({ keyboard: 0 }), state({ keyboard: KB }))).toBe(false);
  });
});
