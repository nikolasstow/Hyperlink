import { describe, expect, it } from "vitest";
import { COMPACT_TOP_MARGIN, COMPACT_ZONE_MAX, contentViewport, isCompact, isCompactWithInput, needsCompactContent } from "./dubzLayout";

// Dubz's own bars, for the tests: a top controls row and the composer pill.
const TOP = 64;
const BOTTOM = 78;

describe("dubzLayout", () => {
  it("is compact at or below the zone ceiling, not above", () => {
    expect(isCompact(COMPACT_ZONE_MAX)).toBe(true);
    expect(isCompact(COMPACT_ZONE_MAX - 1)).toBe(true);
    expect(isCompact(COMPACT_ZONE_MAX + 1)).toBe(false);
  });

  it("a grown input subtracts its growth from the height before the zone test", () => {
    const BASE = 58;
    // One-line input: same as the plain zone test.
    expect(isCompactWithInput(COMPACT_ZONE_MAX, BASE, BASE)).toBe(true);
    expect(isCompactWithInput(COMPACT_ZONE_MAX + 1, BASE, BASE)).toBe(false);
    // A 40pt-taller input subtracts 40, so a window 30 above the ceiling is now
    // compact (it was not for a one-line input).
    expect(isCompactWithInput(COMPACT_ZONE_MAX + 30, BASE + 40, BASE)).toBe(true);
    expect(isCompactWithInput(COMPACT_ZONE_MAX + 30, BASE, BASE)).toBe(false);
  });

  it("the viewport removes both bars out of the zone, only the bottom in it", () => {
    // Out of the compact zone: the top controls take a row, so both bars go.
    expect(contentViewport(400, TOP, BOTTOM)).toBe(400 - TOP - BOTTOM);
    // In the zone: the top controls are a SIDE bar, so only a small top
    // clearance (COMPACT_TOP_MARGIN) is removed, not the full top bar.
    expect(contentViewport(300, TOP, BOTTOM)).toBe(300 - COMPACT_TOP_MARGIN - BOTTOM);
  });

  it("content compacts only when compact AND taller than the viewport", () => {
    const height = 300; // in the zone
    const viewport = contentViewport(height, TOP, BOTTOM); // 300 - 16 - 78 = 206
    // Taller than the viewport, in the zone → compact.
    expect(needsCompactContent(height, viewport + 10, TOP, BOTTOM)).toBe(true);
    // Fits the viewport → no need, even in the zone.
    expect(needsCompactContent(height, viewport - 10, TOP, BOTTOM)).toBe(false);
    // Out of the zone → never compacts, however tall the content.
    expect(needsCompactContent(COMPACT_ZONE_MAX + 1, 100000, TOP, BOTTOM)).toBe(false);
  });
});
