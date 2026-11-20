import { describe, expect, it } from "vitest";
import type { PrintRecord } from "./resinApi";
import { abDiff, decodePosition, nearestContact, positionsIn, globMatches, inTask, activeLine, headTimeline, startedMs, timeKey, dayOf, deltaOf, describeFile, flagLabel, fmtMetric, outcomeKindOf, renderLabel, timeOf } from "./resinFormat";

const record = (fields: Partial<PrintRecord>): PrintRecord => ({
  id: "P8",
  file: "Head 183 A + 184 B",
  sha256: null,
  runA: null,
  runB: null,
  exposure: 1.8,
  started: "2026-11-18 15:17",
  outcome: null,
  notes: null,
  libraryPath: null,
  ...fields,
});

describe("describeFile", () => {
  it("names an A/B plate by its runs", () => {
    expect(describeFile("Head 183 A + 184 B.goo", record({ runA: "2-4", runB: "2-5" }))).toEqual({ title: "Head A/B", detail: "A 2-4 · B 2-5" });
  });

  it("names a plate with one run on both heads", () => {
    expect(describeFile("Head 171 x2.goo", record({ file: "Head 171 x2", runA: "1-153", runB: "1-153" }))).toEqual({ title: "Head ×2", detail: "Run 1-153 on both heads" });
  });

  it("reads an A/B plate from the name when there is no record", () => {
    expect(describeFile("/local/Head 145 + 146 T.goo", undefined)).toEqual({ title: "Head A/B", detail: "A 145 · B 146" });
  });

  it("reads the organizer's names: the subject, when it was sliced, and the copy", () => {
    expect(describeFile("Head — 2026-11-01 00.47 (18).goo", null)).toEqual({ title: "Head", detail: "Sliced Nov 1, 00:47 · copy 18" });
    expect(describeFile("Head — 2026-11-01 00.47 presupported.goo", null)).toEqual({ title: "Head", detail: "Sliced Nov 1, 00:47 · presupported" });
  });

  it("keeps any other name, without the extension", () => {
    expect(describeFile("Beast Torso repaired app supports.goo", null)).toEqual({ title: "Beast Torso repaired app supports", detail: undefined });
  });
});

describe("outcomeKindOf", () => {
  it("reads the run database's outcome text", () => {
    expect(outcomeKindOf("completed, layer separation")).toBe("separated");
    expect(outcomeKindOf("completed")).toBe("completed");
    expect(outcomeKindOf("stopped by owner at layer 8")).toBe("stopped");
    expect(outcomeKindOf("failed")).toBe("failed");
    expect(outcomeKindOf("unknown, near end 2026-11-19 06:34")).toBe("unknown");
    expect(outcomeKindOf(null)).toBe("unknown");
  });
});

describe("labels", () => {
  it("formats metrics, deltas, flags, renders, and start times", () => {
    expect(fmtMetric("validator_passed", 1)).toBe("Passed");
    expect(fmtMetric("body_p99", 3.1515166)).toBe("3.15");
    expect(fmtMetric("placed", 883)).toBe("883");
    expect(deltaOf(5, 3)).toBe("up");
    expect(deltaOf(5, null)).toBeUndefined();
    expect(flagLabel("--junction-radius")).toBe("junction radius");
    expect(renderLabel("whole-front.png")).toBe("Whole, front");
    expect(renderLabel("T164-side.png")).toBe("T164, side");
    expect(dayOf("2026-11-17 19:34 (restart 20:03)")).toBe("2026-11-17");
    expect(timeOf("2026-11-17 19:34 (restart 20:03)")).toBe("19:34 (restart 20:03)");
    expect(timeOf("2026-11-15")).toBeUndefined();
  });
});

describe("abDiff", () => {
  it("lists what A and B test against each other", () => {
    const a = [
      { flag: "--per-junction", value: "3" },
      { flag: "--buttresses", value: null },
      { flag: "--cell", value: "10" },
    ];
    const b = [
      { flag: "--per-junction", value: "2" },
      { flag: "--cell", value: "10" },
      { flag: "--pair-braces", value: null },
    ];
    expect(abDiff(a, b)).toEqual([
      { flag: "--per-junction", a: "3", b: "2" },
      { flag: "--buttresses", a: "on", b: null },
      { flag: "--pair-braces", a: null, b: "on" },
    ]);
  });
});

describe("activeLine", () => {
  it("says the run, its stage, and the minutes left", () => {
    expect(activeLine({ number: 640, stage: "anti-alias", finishAt: 1_000_000 + 240_000 }, 1_000_000)).toBe("Run 640 · anti-alias · 4 min left");
    expect(activeLine({ number: 640, stage: null, finishAt: 1_000_000 }, 1_000_000)).toBe("Run 640 · starting · past the usual time");
  });
});

describe("the head's timeline", () => {
  it("orders prints and notes by time, and keeps a print's notes with it", () => {
    const prints = [
      { id: "P2", started: "2026-11-15 evening to 2026-11-16" },
      { id: "P1", started: "2026-11-15" },
      { id: "P6", started: "2026-11-17 19:34 (restart 20:03)" },
    ];
    const notes = [
      { id: 1, at: "2026-11-17 23:55 UTC", print: "P6" },
      { id: 2, at: "2026-11-19", print: null },
      { id: 3, at: "2026-11-16 09:00", print: null },
    ];
    expect(headTimeline(prints, notes).map((event) => event.key)).toEqual(["P1", "P2", "note-3", "P6", "note-2"]);
    const p6 = headTimeline(prints, notes).find((event) => event.key === "P6");
    expect(p6?.kind === "Print" ? p6.notes.map((note) => note.id) : []).toEqual([1]);
  });

  it("reads start times", () => {
    expect(timeKey("2026-11-17 19:34 (restart 20:03)")).toBe("2026-11-17 19:34");
    expect(startedMs("2026-11-18 15:17")).toBe(new Date(2026, 10, 18, 15, 17).getTime());
    expect(startedMs("Unknown")).toBeUndefined();
  });
});

describe("task patterns", () => {
  it("match library paths as globs", () => {
    expect(globMatches("Library/Beast/Heads/*", "Library/Beast/Heads/goo/Head — 2026-11-01 00.47 (18).goo")).toBe(true);
    expect(globMatches("Drop/Head *", "Drop/Head 171 A + 168 B.goo")).toBe(true);
    expect(globMatches("Drop/Head *", "Drop/Gambit Base 1 + 2.ctp")).toBe(false);
    expect(globMatches("Library/goo/Bodies/*", "Library/goo/Bases/x.goo")).toBe(false);
    expect(inTask({ patterns: ["Library/Beast/Bases/*"] }, "Library/Beast/Bases/goo/b.goo")).toBe(true);
  });
});

describe("position IDs", () => {
  it("decode as tools/posid.py does, and are found in text", () => {
    expect(decodePosition("W34-19BZK1")).toEqual([-22.625, -0.125, 22.375]);
    expect(decodePosition("S51-524")).toBeUndefined();
    expect(positionsIn("A beefed ear support at W34-19BZK1 (pad r 0.3), not S51-524.")).toEqual(["W34-19BZK1"]);
  });

  it("find the nearest contact within a distance", () => {
    const contacts = [{ id: "a", x: 0, y: 0, z: 0 }, { id: "b", x: 5, y: 0, z: 0 }];
    expect(nearestContact(contacts, [4, 0, 0], 2)?.id).toBe("b");
    expect(nearestContact(contacts, [20, 0, 0], 2)).toBeUndefined();
  });
});
