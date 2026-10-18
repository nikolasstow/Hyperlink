import { describe, expect, it } from "vitest";
import { CMD_PAUSE, controlAckLabel, controlRequest, isPrinting, layerIndexOf, parseFrame, phaseLabel, printErrorLabel, refreshRequest } from "./sdcp";

// A status push as the Saturn 4 Ultra 16K (firmware V1.5.6) sends it, trimmed.
const statusPush =
  '{"Status":{"CurrentStatus":[1],"ReleaseFilm":60309,"TempOfUVLED":39.68,"TempOfTank":35,"TempTargetTank":30,"PrintInfo":{"Status":3,"CurrentLayer":417,"TotalLayer":5032,"CurrentTicks":3138083,"TotalTicks":43248021,"ErrorNumber":0,"Filename":"base 9.goo","TaskId":"c4ec7776"}},"MainboardID":"f57dab79766d0100","TimeStamp":1792288414,"Topic":"sdcp/status/f57dab79766d0100"}';

describe("parseFrame", () => {
  it("reads a status push", () => {
    const frame = parseFrame(statusPush);
    expect(frame.kind).toBe("status");
    if (frame.kind !== "status") return;
    expect(frame.mainboardId).toBe("f57dab79766d0100");
    expect(frame.status.PrintInfo?.CurrentLayer).toBe(417);
    expect(isPrinting(frame.status)).toBe(true);
    expect(phaseLabel(frame.status.PrintInfo?.Status)).toBe("Exposing");
  });

  it("reads an attributes push with the brand id", () => {
    const frame = parseFrame('{"Id":"brand","Attributes":{"Name":"Saturn","ReleaseFilmMax":60000},"MainboardID":"mb","Topic":"sdcp/attributes/mb"}');
    expect(frame).toEqual({ kind: "attributes", attributes: { Name: "Saturn", ReleaseFilmMax: 60000 }, brandId: "brand", mainboardId: "mb" });
  });

  it("reads the relay's read-only notice", () => {
    const frame = parseFrame('{"Data":{"Data":{"Message":"The relay is read-only","Type":0},"MainboardID":"mb"},"Topic":"sdcp/notice/mb"}');
    expect(frame).toEqual({ kind: "notice", message: "The relay is read-only" });
  });

  it("reads a command response with its ack", () => {
    const frame = parseFrame('{"Id":"b","Data":{"Cmd":129,"Data":{"Ack":1},"RequestID":"req9","MainboardID":"mb","TimeStamp":1},"Topic":"sdcp/response/mb"}');
    expect(frame).toEqual({ kind: "response", cmd: 129, requestId: "req9", ack: 1 });
    expect(controlAckLabel(1)).toContain("not in a state");
  });

  it("builds a pause request", () => {
    expect(JSON.parse(controlRequest(CMD_PAUSE, { brandId: "b", mainboardId: "mb" }, "r1", 2_000_000)).Data).toEqual({ Cmd: 129, Data: {}, RequestID: "r1", MainboardID: "mb", TimeStamp: 2000, From: 3 });
  });

  it("ignores pong and junk", () => {
    expect(parseFrame("pong").kind).toBe("other");
    expect(parseFrame("{}").kind).toBe("other");
  });
});

describe("layerIndexOf", () => {
  it("maps the 1-based CurrentLayer to the zero-based image", () => {
    expect(layerIndexOf(1, 10)).toBe(0);
    expect(layerIndexOf(0, 10)).toBe(0);
    expect(layerIndexOf(10, 10)).toBe(9);
  });
});

describe("refreshRequest", () => {
  it("builds an SDCP status request", () => {
    const request = JSON.parse(refreshRequest(0, { brandId: "brand", mainboardId: "mb" }, "req1", 1_000_000));
    expect(request).toEqual({
      Id: "brand",
      Data: { Cmd: 0, Data: {}, RequestID: "req1", MainboardID: "mb", TimeStamp: 1000, From: 3 },
      Topic: "sdcp/request/mb",
    });
  });
});

describe("printErrorLabel", () => {
  it("names the print errors", () => {
    expect(printErrorLabel(2)).toBe("File read failed");
    expect(printErrorLabel(42)).toBe("Error 42");
  });
});
