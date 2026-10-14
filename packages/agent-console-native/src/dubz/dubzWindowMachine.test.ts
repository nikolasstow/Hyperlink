import { describe, expect, it } from "vitest";
import { type DubzWindowEvent, type DubzWindowState, initialDubzWindowState, reduceDubzWindow, requestedHeightOf } from "./dubzWindowMachine";

const DEFAULT = 200;
const run = (state: DubzWindowState, ...events: ReadonlyArray<DubzWindowEvent>): DubzWindowState => events.reduce(reduceDubzWindow, state);
const start = initialDubzWindowState(DEFAULT);

describe("dubzWindowMachine", () => {
  it("opens only on an explicit open", () => {
    expect(run(start, { _tag: "openRequested" }).phase).toBe("open");
    // A keyboard event never opens it.
    expect(run(start, { _tag: "keyboardShown" }).phase).toBe("closed");
  });

  it("BUG: after a dismiss, a late keyboard event never reopens it", () => {
    const after = run(
      start,
      { _tag: "openRequested" },
      { _tag: "keyboardShown" },
      { _tag: "closeRequested", reason: "dismiss" },
      // The straggling events that used to bring it back:
      { _tag: "keyboardHidden" },
      { _tag: "keyboardShown" },
      { _tag: "heightSettled", height: 500 },
    );
    expect(after.phase).toBe("closed");
  });

  it("BUG: the keyboard only toggles its own flag; the requested height holds", () => {
    const open = run(start, { _tag: "openRequested" });
    expect(requestedHeightOf(open)).toBe(DEFAULT);
    const up = run(open, { _tag: "keyboardShown" });
    const down = run(up, { _tag: "keyboardHidden" });
    expect(up.keyboard).toBe("up");
    expect(down.keyboard).toBe("down");
    // The request never moved — only the renderer's clamp does.
    expect(requestedHeightOf(up)).toBe(DEFAULT);
    expect(requestedHeightOf(down)).toBe(DEFAULT);
  });

  it("a drag sets a new default that sticks", () => {
    const open = run(start, { _tag: "openRequested" }, { _tag: "heightSettled", height: 420 });
    expect(open.defaultHeight).toBe(420);
    expect(requestedHeightOf(open)).toBe(420);
    // Ignored while closed.
    const closed = run(start, { _tag: "heightSettled", height: 420 });
    expect(closed.defaultHeight).toBe(DEFAULT);
  });

  it("an active, taller component raises the request; shorter does not", () => {
    const open = run(start, { _tag: "openRequested" });
    const taller = run(open, { _tag: "componentActivated", height: 500 });
    expect(requestedHeightOf(taller)).toBe(500);
    const shorter = run(open, { _tag: "componentActivated", height: 120 });
    expect(requestedHeightOf(shorter)).toBe(DEFAULT);
  });

  it("a drag pins the height OVER an active component (compact is reachable)", () => {
    const active = run(start, { _tag: "openRequested" }, { _tag: "componentActivated", height: 500 });
    expect(requestedHeightOf(active)).toBe(500); // the active component grows the window
    // Drag down into the compact zone: the pin wins over the 500 claim.
    const compact = run(active, { _tag: "heightSettled", height: 150 });
    expect(compact.pinned).toBe(true);
    expect(requestedHeightOf(compact)).toBe(150);
    // Content grows under it: still compact (the pin holds).
    const grown = run(compact, { _tag: "componentHeightChanged", height: 600 });
    expect(requestedHeightOf(grown)).toBe(150);
    // A fresh (re)activation clears the pin and grows the window to show itself.
    const reactivated = run(grown, { _tag: "componentActivated", height: 700 });
    expect(reactivated.pinned).toBe(false);
    expect(requestedHeightOf(reactivated)).toBe(700);
  });

  it("layoutChanged sets the compact flags, dedups, and resets on close", () => {
    const open = run(start, { _tag: "openRequested" }, { _tag: "layoutChanged", compact: true, compactContent: true });
    expect(open.compact).toBe(true);
    expect(open.compactContent).toBe(true);
    // Dedup: the same flags return the same state object.
    expect(run(open, { _tag: "layoutChanged", compact: true, compactContent: true })).toBe(open);
    // Close resets the display mode.
    const closed = run(open, { _tag: "closeRequested", reason: "dismiss" });
    expect(closed.compact).toBe(false);
    expect(closed.compactContent).toBe(false);
  });

  it("a component height change reruns the calculation, and deactivation returns to the default", () => {
    const active = run(start, { _tag: "openRequested" }, { _tag: "componentActivated", height: 500 });
    const grown = run(active, { _tag: "componentHeightChanged", height: 650 });
    expect(requestedHeightOf(grown)).toBe(650);
    const gone = run(grown, { _tag: "componentDeactivated" });
    expect(gone.activeHeight).toBeUndefined();
    expect(requestedHeightOf(gone)).toBe(DEFAULT);
    // A change with nothing active is ignored.
    const noop = run(run(start, { _tag: "openRequested" }), { _tag: "componentHeightChanged", height: 650 });
    expect(noop.activeHeight).toBeUndefined();
  });
});
