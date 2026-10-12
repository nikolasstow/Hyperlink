import { describe, expect, it, vi } from "vitest";
import { carriedOverAddress, deriveBackendAddress, opencodeAddressOf } from "./settings";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {},
}));

describe("server address", () => {
  it("carries a saved opencode address over to the API server on the same host", () => {
    expect(carriedOverAddress("100.67.32.32:4096")).toBe("http://100.67.32.32:5199");
    expect(carriedOverAddress("http://mac.local:4096/")).toBe("http://mac.local:5199");
  });

  it("keeps an address typed some other way", () => {
    expect(carriedOverAddress("100.67.32.32:5299")).toBe("100.67.32.32:5299");
    expect(carriedOverAddress("not an address")).toBe("not an address");
  });

  it("reaches opencode under the server, and the backend on the same host", () => {
    expect(opencodeAddressOf("100.67.32.32:5199")).toBe("http://100.67.32.32:5199/opencode");
    expect(opencodeAddressOf("http://100.67.32.32:5199/")).toBe("http://100.67.32.32:5199/opencode");
    expect(deriveBackendAddress("100.67.32.32:5199")).toBe("http://100.67.32.32:5195");
  });
});
