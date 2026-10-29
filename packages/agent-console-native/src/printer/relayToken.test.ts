import { Effect, Option } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const kept = new Map<string, string>();
const native: Array<string> = [];

vi.mock("../../modules/live-activity", () => ({
  setPrinterRelayToken: (token: string) => {
    native.push(token);
  },
}));

vi.mock("../auth/secretStoreNative", () => ({
  keychain: {
    available: true,
    get: (key: string) => Effect.succeed(Option.fromNullishOr(kept.get(key))),
    set: (key: string, value: string) => Effect.sync(() => void kept.set(key, value)),
    remove: (key: string) => Effect.sync(() => void kept.delete(key)),
  },
}));

const { cameraPageUrl, keyOf, loadRelayToken, saveRelayToken } = await import("./relayToken");
const { tokenFor } = await import("../auth/serverTokens");

describe("relayToken", () => {
  beforeEach(() => {
    kept.clear();
    native.length = 0;
  });

  it("names the Keychain entry with the characters the Keychain takes", () => {
    expect(keyOf("http://100.67.32.32:5197")).toBe("agent-console-native.printer.relay-token.http___100.67.32.32_5197");
  });

  it("keeps, uses, and removes the token", async () => {
    await saveRelayToken("http://mini:5197", "  abc  ");
    expect(kept.get(keyOf("http://mini:5197"))).toBe("abc");
    expect(tokenFor("http://mini:5197/api/state")).toBe("abc");
    expect(native).toEqual(["abc"]);

    await saveRelayToken("http://mini:5197", "");
    expect(kept.has(keyOf("http://mini:5197"))).toBe(false);
    expect(tokenFor("http://mini:5197/api/state")).toBeUndefined();
    expect(native).toEqual(["abc", ""]);
  });

  it("reads the kept token at launch, and sends none without one", async () => {
    await loadRelayToken("http://other:5197");
    expect(tokenFor("http://other:5197/api/state")).toBeUndefined();
    expect(native).toEqual([""]);
    kept.set(keyOf("http://other:5197"), "kept");
    await loadRelayToken("http://other:5197");
    expect(tokenFor("http://other:5197/api/state")).toBe("kept");
  });

  it("adds the token to the camera page's address only when there is one", () => {
    expect(cameraPageUrl("https://mini.ts.net", undefined)).toBe("https://mini.ts.net/?view=camera&bare=1");
    expect(cameraPageUrl("https://mini.ts.net", "a b")).toBe("https://mini.ts.net/?view=camera&bare=1&token=a%20b");
  });
});
