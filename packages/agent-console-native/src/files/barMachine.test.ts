import { describe, expect, it } from "vitest";
import { barView, checkInvariants, Closing, Dubz, DraggingToDubz, DraggingToTabs, DragRelease, DragStart, DubzClosed, Opening, reduce, Settled, Tabs, TapDubz, type BarEvent, type BarMode } from "./barMachine";

const modes: ReadonlyArray<BarMode> = [Tabs, DraggingToDubz, Opening, Dubz, DraggingToTabs, Closing];

const tag = (mode: BarMode): string => mode._tag;

describe("reduce — the happy paths", () => {
  it("tap opens from the tabs nav, then settles into Dubz", () => {
    const opening = reduce(Tabs, TapDubz);
    expect(tag(opening)).toBe("Opening");
    expect(tag(reduce(opening, Settled))).toBe("Dubz");
  });

  it("swipe opens: drag, commit past the turn, settle", () => {
    const dragging = reduce(Tabs, DragStart);
    expect(tag(dragging)).toBe("DraggingToDubz");
    const opening = reduce(dragging, DragRelease(0.3, 0));
    expect(tag(opening)).toBe("Opening");
    expect(tag(reduce(opening, Settled))).toBe("Dubz");
  });

  it("swipe open that doesn't reach the turn springs back to the tabs nav", () => {
    const dragging = reduce(Tabs, DragStart);
    const closing = reduce(dragging, DragRelease(0.1, 0));
    expect(tag(closing)).toBe("Closing");
    expect(tag(reduce(closing, Settled))).toBe("Tabs");
  });

  it("a flick opens even from barely moved", () => {
    const dragging = reduce(Tabs, DragStart);
    expect(tag(reduce(dragging, DragRelease(0.05, 1.5)))).toBe("Opening");
  });

  it("swipe back: from Dubz, drag, commit, settle to the tabs nav", () => {
    const dragging = reduce(Dubz, DragStart);
    expect(tag(dragging)).toBe("DraggingToTabs");
    const closing = reduce(dragging, DragRelease(0.5, 0));
    expect(tag(closing)).toBe("Closing");
    expect(tag(reduce(closing, Settled))).toBe("Tabs");
  });

  it("swipe back that doesn't reach the turn springs back to Dubz with no close", () => {
    const dragging = reduce(Dubz, DragStart);
    // Still mostly open (progress near 1): springs straight back to Dubz, so
    // the window never flickered closed.
    expect(tag(reduce(dragging, DragRelease(0.9, 0)))).toBe("Dubz");
  });

  it("a downward flick back closes even when near fully open", () => {
    const dragging = reduce(Dubz, DragStart);
    expect(tag(reduce(dragging, DragRelease(0.95, -1.5)))).toBe("Closing");
  });

  it("the window closing itself slides out", () => {
    expect(tag(reduce(Dubz, DubzClosed("dismiss")))).toBe("Closing");
    expect(tag(reduce(Dubz, DubzClosed("keyboard")))).toBe("Closing");
  });
});

describe("reduce — totality (every illegal event is a no-op, never a throw)", () => {
  const events: ReadonlyArray<BarEvent> = [
    TapDubz,
    DragStart,
    DragRelease(0.5, 0),
    Settled,
    DubzClosed("dismiss"),
  ];

  it("returns a valid mode for every (mode, event) and never throws", () => {
    for (const mode of modes) {
      for (const event of events) {
        const next = reduce(mode, event);
        expect(modes.map(tag)).toContain(tag(next));
      }
    }
  });

  it("tap does nothing except on the tabs nav", () => {
    for (const mode of modes) {
      if (tag(mode) === "Tabs") continue;
      expect(tag(reduce(mode, TapDubz))).toBe(tag(mode));
    }
  });

  it("settled does nothing outside an animating mode", () => {
    for (const mode of modes) {
      const expected = tag(mode) === "Opening" ? "Dubz" : tag(mode) === "Closing" ? "Tabs" : tag(mode);
      expect(tag(reduce(mode, Settled))).toBe(expected);
    }
  });

  it("drag start only engages from a resting mode", () => {
    expect(tag(reduce(Opening, DragStart))).toBe("Opening");
    expect(tag(reduce(Closing, DragStart))).toBe("Closing");
    expect(tag(reduce(DraggingToDubz, DragStart))).toBe("DraggingToDubz");
  });
});

describe("barView — derived, consistent", () => {
  it("only the resting modes are interactive, and never both at once", () => {
    for (const mode of modes) {
      const view = barView(mode);
      expect(view.barInteractive && view.dubzInteractive).toBe(false);
    }
    expect(barView(Tabs).barInteractive).toBe(true);
    expect(barView(Dubz).dubzInteractive).toBe(true);
  });

  it("the window is open exactly in Dubz territory", () => {
    expect(barView(Dubz).dubzOpen).toBe(true);
    expect(barView(DraggingToTabs).dubzOpen).toBe(true);
    expect(barView(Opening).dubzOpen).toBe(false);
    expect(barView(Closing).dubzOpen).toBe(false);
    expect(barView(Tabs).dubzOpen).toBe(false);
  });

  it("pageX follows the finger only while dragging", () => {
    expect(barView(DraggingToDubz).pageX).toEqual({ kind: "drag" });
    expect(barView(DraggingToTabs).pageX).toEqual({ kind: "drag" });
    expect(barView(Opening).pageX).toEqual({ kind: "animate", to: 1 });
    expect(barView(Tabs).pageX).toEqual({ kind: "animate", to: 0 });
  });
});

describe("checkInvariants", () => {
  it("holds for every reachable mode", () => {
    for (const mode of modes) expect(() => checkInvariants(mode)).not.toThrow();
  });
});
