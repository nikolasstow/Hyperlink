import { describe, expect, it } from "vitest";
import { advanceFlash, enqueueFlash, initialSaveLight, type SaveLightState } from "./saveLight";

describe("enqueueFlash", () => {
  it("shows at once when idle", () => {
    expect(enqueueFlash(initialSaveLight, "local")).toEqual({ current: "local", pending: [] });
  });

  it("drops a flash that would queue the same colour back-to-back", () => {
    const state: SaveLightState = { current: "local", pending: [] };
    expect(enqueueFlash(state, "local")).toBe(state);
  });

  it("flashes the same colour again once at rest (twice in a row is fine when not queued)", () => {
    // local flashes, finishes (→ rest), local flashes again.
    const afterFirst = advanceFlash(enqueueFlash(initialSaveLight, "local"));
    expect(afterFirst).toEqual(initialSaveLight);
    expect(enqueueFlash(afterFirst, "local")).toEqual({ current: "local", pending: [] });
  });

  it("queues a different colour behind the current one", () => {
    const state: SaveLightState = { current: "local", pending: [] };
    expect(enqueueFlash(state, "cloud")).toEqual({ current: "local", pending: ["cloud"] });
  });

  it("lets colours alternate in the queue", () => {
    let state: SaveLightState = { current: "local", pending: [] };
    state = enqueueFlash(state, "cloud");
    state = enqueueFlash(state, "local");
    expect(state).toEqual({ current: "local", pending: ["cloud", "local"] });
  });

  it("dedupes by the tail of the queue, not the current", () => {
    const state: SaveLightState = { current: "local", pending: ["cloud"] };
    // Tail is cloud → a cloud flash is dropped,
    expect(enqueueFlash(state, "cloud")).toBe(state);
    // but a local flash follows it (tail was cloud, not local).
    expect(enqueueFlash(state, "local")).toEqual({ current: "local", pending: ["cloud", "local"] });
  });
});

describe("advanceFlash", () => {
  it("goes to rest when nothing is waiting", () => {
    expect(advanceFlash({ current: "local", pending: [] })).toEqual(initialSaveLight);
  });

  it("shows the next waiting flash", () => {
    expect(advanceFlash({ current: "local", pending: ["cloud", "local"] })).toEqual({ current: "cloud", pending: ["local"] });
  });
});
