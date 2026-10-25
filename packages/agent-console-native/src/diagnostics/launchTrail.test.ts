import { beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(stored.get(key) ?? null),
    setItem: (key: string, value: string) => {
      stored.set(key, value);
      return Promise.resolve();
    },
  },
}));

const posted: Array<string> = [];
vi.stubGlobal("fetch", (_url: string, init: { readonly body: string }) => {
  posted.push(init.body);
  return Promise.resolve(new Response(null, { status: 204 }));
});

const KEY = "agent-console-native:launchTrail";

/** A fresh copy of the module: each import is one launch. */
const launch = async () => {
  vi.resetModules();
  return import("./launchTrail");
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("launch trail", () => {
  beforeEach(() => {
    stored.clear();
    posted.length = 0;
  });

  it("reports a launch that never became stable, at the next launch", async () => {
    const first = await launch();
    first.mark("JS started");
    first.mark("printer page mounted");
    await settle();

    const second = await launch();
    const last = await second.unfinishedPrevious();
    expect(last?.steps.map((entry) => entry.step)).toEqual(["JS started", "printer page mounted"]);
    expect(second.describeTrail(last!)).toMatch(/^\+\d+ms JS started\n\+\d+ms printer page mounted$/);
  });

  it("does not report a stable launch, and keeps the last trail until this one writes", async () => {
    const first = await launch();
    first.mark("JS started");
    first.markStable();
    await settle();
    expect(stored.get(KEY)).toContain("\"stable\":true");

    const second = await launch();
    expect(await second.unfinishedPrevious()).toBeUndefined();
  });

  it("sends the steps to the relay once it is known, with what waited", async () => {
    const trail = await launch();
    trail.mark("JS started");
    expect(posted).toEqual([]);
    trail.setTrailRelay("http://relay:5197");
    trail.mark("navigator mounted");
    await settle();
    expect(posted.join("\n")).toMatch(/JS started/);
    expect(posted.join("\n")).toMatch(/navigator mounted/);
  });
});
