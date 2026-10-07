import { describe, expect, it } from "vitest";
import { checkInvariants, Dragging, DragRelease, DragStart, Idle, reduce, Settled, Settling, type TabSwipeEvent, type TabSwipeMode, view } from "./tabSwipe";

const modes: ReadonlyArray<TabSwipeMode> = [Idle, Dragging, Settling(-1), Settling(1)];
const tag = (mode: TabSwipeMode): string => mode._tag;

describe("reduce — turning to a neighbour", () => {
  it("drags, turns to the previous tab past the third, settles", () => {
    const dragging = reduce(Idle, DragStart);
    expect(tag(dragging)).toBe("Dragging");
    const settling = reduce(dragging, DragRelease(0.5, 0, true, true));
    expect(settling).toEqual(Settling(-1));
    expect(reduce(settling, Settled)).toEqual(Idle);
  });

  it("turns to the next tab on a leftward drag", () => {
    expect(reduce(Dragging, DragRelease(-0.5, 0, true, true))).toEqual(Settling(1));
  });

  it("a flick turns even from barely moved", () => {
    expect(reduce(Dragging, DragRelease(0.05, 1, true, true))).toEqual(Settling(-1));
    expect(reduce(Dragging, DragRelease(-0.05, -1, true, true))).toEqual(Settling(1));
  });

  it("springs back when it doesn't reach the turn", () => {
    expect(reduce(Dragging, DragRelease(0.1, 0, true, true))).toEqual(Idle);
  });

  it("never turns past the first or last tab (no neighbour)", () => {
    expect(reduce(Dragging, DragRelease(0.9, 5, false, true))).toEqual(Idle); // no prev
    expect(reduce(Dragging, DragRelease(-0.9, -5, true, false))).toEqual(Idle); // no next
  });
});

describe("reduce — totality (illegal events no-op, never throw)", () => {
  const events: ReadonlyArray<TabSwipeEvent> = [DragStart, DragRelease(0, 0, true, true), Settled];
  it("returns a valid mode for every (mode, event)", () => {
    for (const mode of modes) {
      for (const event of events) expect(modes.map(tag)).toContain(tag(reduce(mode, event)));
    }
  });
  it("drag start only engages from idle; release only from dragging; settled only from settling", () => {
    expect(reduce(Dragging, DragStart)).toEqual(Dragging);
    expect(reduce(Settling(1), DragStart)).toEqual(Settling(1));
    expect(reduce(Idle, DragRelease(0.9, 0, true, true))).toEqual(Idle);
    expect(reduce(Idle, Settled)).toEqual(Idle);
    expect(reduce(Dragging, Settled)).toEqual(Dragging);
  });
});

describe("view — derived", () => {
  it("swipe drags only while dragging, animates home when idle", () => {
    expect(view(Idle).swipe).toEqual({ kind: "animate", to: 0 });
    expect(view(Dragging).swipe).toEqual({ kind: "drag" });
  });
  it("settling animates the cards toward the neighbour and names it to commit", () => {
    expect(view(Settling(-1))).toEqual({ swipe: { kind: "animate", to: 1 }, commit: -1, swiping: true });
    expect(view(Settling(1))).toEqual({ swipe: { kind: "animate", to: -1 }, commit: 1, swiping: true });
  });
  it("swiping covers both dragging and settling", () => {
    expect(view(Idle).swiping).toBe(false);
    expect(view(Dragging).swiping).toBe(true);
    expect(view(Settling(1)).swiping).toBe(true);
  });
});

describe("checkInvariants", () => {
  it("holds for every mode", () => {
    for (const mode of modes) expect(() => checkInvariants(mode)).not.toThrow();
  });
});
