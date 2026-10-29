import { beforeEach, describe, expect, it } from "vitest";
import { authedSource, authHeaders, setRelayToken, setServerTokens, tokenFor } from "./serverTokens";

describe("serverTokens with a printer relay", () => {
  beforeEach(() => {
    setServerTokens(new Map([["http://mini:4096", "server-token"]]));
    setRelayToken("http://mini:5197", undefined);
  });

  it("sends no token to the relay until it has one", () => {
    expect(tokenFor("http://mini:5197/api/state")).toBeUndefined();
    expect(authHeaders("http://mini:5197/api/state")).toEqual({});
    expect(authedSource("http://mini:5197/api/prints/t/preview.png")).toEqual({ uri: "http://mini:5197/api/prints/t/preview.png" });
  });

  it("sends the relay's own token to the relay only", () => {
    setRelayToken("http://mini:5197", "relay-token");
    expect(authHeaders("http://mini:5197/api/state")).toEqual({ authorization: "Bearer relay-token" });
    expect(authHeaders("http://mini:4096/session")).toEqual({ authorization: "Bearer server-token" });
    expect(authHeaders("http://printer:3030/websocket")).toEqual({});
    expect(authedSource("http://mini:5197/a.png")).toEqual({ uri: "http://mini:5197/a.png", headers: { authorization: "Bearer relay-token" } });
    // A data image never carries it.
    expect(authedSource("data:image/png;base64,AA")).toEqual({ uri: "data:image/png;base64,AA" });
  });

  it("counts a ws(s) URL as its http(s) origin", () => {
    setRelayToken("http://mini:5197", "relay-token");
    setRelayToken("https://mini.tail.ts.net", "relay-token");
    expect(tokenFor("ws://mini:5197/websocket")).toBe("relay-token");
    expect(tokenFor("wss://mini.tail.ts.net/api/camera.h264")).toBe("relay-token");
  });

  it("forgets a removed token", () => {
    setRelayToken("http://mini:5197", "relay-token");
    setRelayToken("http://mini:5197", undefined);
    expect(tokenFor("http://mini:5197/api/state")).toBeUndefined();
  });
});
