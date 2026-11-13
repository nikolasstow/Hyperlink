import { describe, expect, it } from "vitest";
import { type AccessUnit, ackOf, behindBytes, caughtUpBytes, firstRetryMs, frigatePathAllowed, pace, parseEnv, relativeMove, startPace } from "./cameras";

const key: AccessUnit = {
  data: new Uint8Array(1),
  key: true,
};
const delta: AccessUnit = {
  data: new Uint8Array(1),
  key: false,
};

describe("pace", () => {
  it("starts on a keyframe, not on a delta frame", () => {
    const start = startPace("auto", 0);
    expect(pace(start, delta, 0, "auto", 0)[1]._tag).toBe("drop");
    expect(pace(start, key, 0, "auto", 0)[1]._tag).toBe("send");
  });

  it("drops frames up to the next keyframe when the socket falls behind", () => {
    const [sending] = pace(startPace("high", 0), key, 0, "high", 0);
    const [behind, step] = pace(sending, delta, behindBytes.high + 1, "high", 1);
    expect(step._tag).toBe("drop");
    expect(pace(behind, delta, 0, "high", 2)[1]._tag).toBe("drop");
    expect(pace(behind, key, caughtUpBytes + 1, "high", 3)[1]._tag).toBe("drop");
    expect(pace(behind, key, 0, "high", 4)[1]._tag).toBe("send");
  });

  it("moves an auto viewer to the sub stream after two drops, and back later", () => {
    let [state] = pace(startPace("auto", 0), key, 0, "auto", 0);
    [state] = pace(state, delta, behindBytes.high + 1, "auto", 1000);
    [state] = pace(state, key, 0, "auto", 2000);
    const [low, step] = pace(state, delta, behindBytes.high + 1, "auto", 3000);
    expect(step).toEqual({ _tag: "switch", to: "low" });
    expect(low.level).toBe("low");
    expect(pace(low, key, 0, "auto", 3000 + firstRetryMs - 1)[1]._tag).toBe("send");
    expect(pace(low, key, 0, "auto", 3000 + firstRetryMs)[1]).toEqual({ _tag: "switch", to: "high" });
  });

  it("never switches a fixed quality", () => {
    let [state] = pace(startPace("high", 0), key, 0, "high", 0);
    for (let at = 1; at < 6; at++) {
      const [next, step] = pace(state, at % 2 === 0 ? key : delta, behindBytes.high + 1, "high", at);
      expect(step._tag).not.toBe("switch");
      state = next;
    }
    expect(state.level).toBe("high");
  });
});

describe("relativeMove", () => {
  it("negates pan for a Tapo C200 and scales the step", () => {
    expect(relativeMove(1, 0)).toContain('x="-0.0600" y="0.0000"');
    expect(relativeMove(0, -1)).toContain('x="0.0000" y="-0.0600"');
    expect(relativeMove(5, 5)).toContain('x="-0.0600" y="0.0600"');
  });
});

describe("frigatePathAllowed", () => {
  it("allows review, recordings and VOD, and nothing else", () => {
    expect(frigatePathAllowed("api/review?cameras=cam2&limit=50")).toBe(true);
    expect(frigatePathAllowed("api/cam2/recordings/summary")).toBe(true);
    expect(frigatePathAllowed("clips/review/thumb-cam2-1.webp")).toBe(true);
    expect(frigatePathAllowed("vod/cam2/start/1/end/2/index.m3u8")).toBe(true);
    expect(frigatePathAllowed("api/config")).toBe(false);
    expect(frigatePathAllowed("api/users")).toBe(false);
    expect(frigatePathAllowed("vod/../api/users")).toBe(false);
  });
});

describe("parseEnv", () => {
  it("reads KEY=VALUE lines, with quotes and comments", () => {
    const env = parseEnv('# login\nCAM_USER=me\nCAM_PASS="a=b"\n');
    expect(env.get("CAM_USER")).toBe("me");
    expect(env.get("CAM_PASS")).toBe("a=b");
  });
});

describe("ackOf", () => {
  it("reads the app's byte count", () => {
    expect(ackOf("ack 12345")).toBe(12345);
    expect(ackOf(new TextEncoder().encode("ack 7"))).toBe(7);
    expect(ackOf("hello")).toBeUndefined();
  });
});
