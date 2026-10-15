import { describe, expect, it } from "vitest";
import type { ModelOption } from "../models";
import { effortLabel, modelRefOf } from "./effort";

const fable: ModelOption = { providerID: "opencode", providerName: "OpenCode", modelID: "claude-fable-5-1", name: "Fable", variants: ["low", "high", "xhigh", "max"] };

describe("modelRefOf", () => {
  it("sends the chosen effort as the model's variant, and none for the default", () => {
    expect(modelRefOf(fable, "xhigh")).toEqual({ providerID: "opencode", id: "claude-fable-5-1", variant: "xhigh" });
    expect(modelRefOf(fable, undefined)).toEqual({ providerID: "opencode", id: "claude-fable-5-1" });
  });
});

describe("effortLabel", () => {
  it("names the levels as a picker shows them", () => {
    expect([undefined, "none", "low", "xhigh", "max"].map(effortLabel)).toEqual(["Default", "None", "Low", "Extra High", "Max"]);
  });
});
