/**
 * Pure-logic coverage for the builds data layer. The narrowing is exercised on
 * the exact shapes the backend's `/builds` endpoints emit (see
 * `packages/agent-console/src/server/buildsPlugin.ts`), including the malformed
 * ones an open `eas build:view` record can produce.
 */
import { describe, expect, it } from "vitest";
import {
  buildDetailUrl,
  buildLogsUrl,
  buildsUrl,
  firstLine,
  formatDuration,
  hasActiveBuild,
  httpErrorMessage,
  isRunningStatus,
  isTerminalStatus,
  levelTone,
  phaseLabel,
  phaseTone,
  relativeTimeOf,
  shortCommit,
  statusTone,
  tailLines,
  toBuildDetail,
  toBuildRow,
  toLogPhases,
} from "./builds";

describe("toBuildRow", () => {
  const raw = {
    id: "abc-123",
    status: "FINISHED",
    platform: "IOS",
    buildProfile: "preview",
    appVersion: "1.0.0",
    gitCommitMessage: "feat: a thing\n\nbody",
    artifacts: { buildUrl: "https://expo.dev/artifacts/eas/x.ipa" },
    app: { slug: "double-agent", ownerAccount: { name: "nikolasstow" } },
  };

  it("flattens the nested artifact and app fields", () => {
    const row = toBuildRow(raw);
    expect(row?.buildUrl).toBe("https://expo.dev/artifacts/eas/x.ipa");
    expect(row?.appSlug).toBe("double-agent");
    expect(row?.ownerName).toBe("nikolasstow");
  });

  it("drops a row with no id or no status — it could not be opened", () => {
    expect(toBuildRow({ status: "FINISHED" })).toBeUndefined();
    expect(toBuildRow({ id: "abc" })).toBeUndefined();
    expect(toBuildRow(undefined)).toBeUndefined();
    expect(toBuildRow("nope")).toBeUndefined();
  });

  it("tolerates every optional field being absent", () => {
    const row = toBuildRow({ id: "abc", status: "NEW" });
    expect(row?.id).toBe("abc");
    expect(row?.platform).toBeUndefined();
    expect(row?.buildUrl).toBeUndefined();
    expect(row?.ownerName).toBeUndefined();
  });

  it("ignores fields of the wrong type rather than passing them through", () => {
    const row = toBuildRow({
      id: "abc",
      status: "NEW",
      platform: 7,
      artifacts: "not-an-object",
      app: { slug: null, ownerAccount: 3 },
    });
    expect(row?.platform).toBeUndefined();
    expect(row?.buildUrl).toBeUndefined();
    expect(row?.appSlug).toBeUndefined();
    expect(row?.ownerName).toBeUndefined();
  });
});

describe("toBuildDetail", () => {
  it("reads metrics, actor and artifacts out of the open record", () => {
    const detail = toBuildDetail({
      id: "abc",
      status: "FINISHED",
      buildProfile: "production",
      gitCommitHash: "1234567890abcdef",
      appBuildVersion: "42",
      distribution: "INTERNAL",
      initiatingActor: { displayName: "nikolasstow" },
      artifacts: { buildUrl: "https://x/y.ipa" },
      metrics: { buildQueueTime: 1000, buildWaitTime: 2000, buildDuration: 300000 },
    });
    expect(detail?.initiatingActorName).toBe("nikolasstow");
    expect(detail?.buildUrl).toBe("https://x/y.ipa");
    expect(detail?.metrics).toEqual({ queueTimeMs: 1000, waitTimeMs: 2000, durationMs: 300000 });
  });

  it("requires a status — without one there is nothing to render", () => {
    expect(toBuildDetail({ id: "abc" })).toBeUndefined();
    expect(toBuildDetail(null)).toBeUndefined();
  });

  it("drops a metrics object that carries no usable number", () => {
    expect(toBuildDetail({ status: "NEW", metrics: {} })?.metrics).toBeUndefined();
    expect(toBuildDetail({ status: "NEW", metrics: { buildDuration: "soon" } })?.metrics).toBeUndefined();
  });

  it("reads an error given as a string, an object, or a coded object", () => {
    expect(toBuildDetail({ status: "ERRORED", error: "it broke" })?.error).toBe("it broke");
    expect(toBuildDetail({ status: "ERRORED", error: { message: "it broke" } })?.error).toBe("it broke");
    expect(
      toBuildDetail({ status: "ERRORED", error: { errorCode: "EAS_BUILD_FAILED", message: "it broke" } })?.error,
    ).toBe("EAS_BUILD_FAILED: it broke");
  });

  it("has no error for a build that did not fail", () => {
    expect(toBuildDetail({ status: "FINISHED" })?.error).toBeUndefined();
    expect(toBuildDetail({ status: "FINISHED", error: null })?.error).toBeUndefined();
    expect(toBuildDetail({ status: "FINISHED", error: "  " })?.error).toBeUndefined();
  });
});

describe("toLogPhases", () => {
  it("reads the backend's phase grouping in order", () => {
    const phases = toLogPhases({
      phases: [
        { phase: "SPIN_UP_BUILDER", lines: [{ level: 30, msg: "starting", time: "2026-09-09T00:00:00Z" }] },
        { phase: "RUN_FASTLANE", lines: [{ level: 50, msg: "boom" }] },
      ],
    });
    expect(phases.map((p) => p.phase)).toEqual(["SPIN_UP_BUILDER", "RUN_FASTLANE"]);
    expect(phases[1]?.lines[0]).toEqual({ level: 50, msg: "boom", time: undefined });
  });

  it("defaults a missing level to info and a missing msg to empty", () => {
    const phases = toLogPhases({ phases: [{ phase: "X", lines: [{}] }] });
    expect(phases[0]?.lines[0]).toEqual({ level: 30, msg: "", time: undefined });
  });

  it("returns empty for a queued build with no log yet", () => {
    expect(toLogPhases({ phases: [] })).toEqual([]);
  });

  it("returns empty rather than throwing on a malformed body", () => {
    expect(toLogPhases(undefined)).toEqual([]);
    expect(toLogPhases({ phases: "nope" })).toEqual([]);
    expect(toLogPhases({})).toEqual([]);
  });

  it("skips entries that are not phases, keeping the rest", () => {
    const phases = toLogPhases({ phases: [{ phase: "A", lines: [] }, "junk", { lines: [] }, { phase: "B" }] });
    expect(phases.map((p) => p.phase)).toEqual(["A", "B"]);
    expect(phases[1]?.lines).toEqual([]);
  });
});

describe("status helpers", () => {
  it("treats only finished, errored and canceled as terminal", () => {
    expect(isTerminalStatus("FINISHED")).toBe(true);
    expect(isTerminalStatus("ERRORED")).toBe(true);
    expect(isTerminalStatus("CANCELED")).toBe(true);
    expect(isTerminalStatus("NEW")).toBe(false);
    expect(isTerminalStatus("IN_QUEUE")).toBe(false);
    expect(isTerminalStatus("IN_PROGRESS")).toBe(false);
  });

  it("treats an unknown status as non-terminal, so polling continues", () => {
    expect(isTerminalStatus("SOMETHING_NEW")).toBe(false);
  });

  it("polls while any single build is still moving", () => {
    expect(hasActiveBuild([{ status: "FINISHED" }, { status: "ERRORED" }])).toBe(false);
    expect(hasActiveBuild([{ status: "FINISHED" }, { status: "IN_PROGRESS" }])).toBe(true);
    expect(hasActiveBuild([])).toBe(false);
  });

  it("maps each status to its tone", () => {
    expect(statusTone("FINISHED")).toBe("success");
    expect(statusTone("ERRORED")).toBe("danger");
    expect(statusTone("IN_PROGRESS")).toBe("active");
    expect(statusTone("IN_QUEUE")).toBe("active");
    expect(statusTone("NEW")).toBe("active");
    expect(statusTone("CANCELED")).toBe("neutral");
    expect(statusTone("SOMETHING_NEW")).toBe("neutral");
  });

  it("spins only for a build actually queued or running", () => {
    expect(isRunningStatus("IN_PROGRESS")).toBe(true);
    expect(isRunningStatus("IN_QUEUE")).toBe(true);
    expect(isRunningStatus("NEW")).toBe(false);
    expect(isRunningStatus("FINISHED")).toBe(false);
  });
});

describe("log level helpers", () => {
  it("maps bunyan levels to tones", () => {
    expect(levelTone(30)).toBe("info");
    expect(levelTone(40)).toBe("warn");
    expect(levelTone(50)).toBe("error");
  });

  it("buckets levels between and above the named ones", () => {
    expect(levelTone(20)).toBe("info");
    expect(levelTone(45)).toBe("warn");
    expect(levelTone(60)).toBe("error");
  });

  it("gives a phase the worst tone it contains, so a collapsed phase still shows it failed", () => {
    expect(phaseTone({ phase: "A", lines: [{ level: 30, msg: "", time: undefined }] })).toBe("info");
    expect(
      phaseTone({
        phase: "A",
        lines: [
          { level: 30, msg: "", time: undefined },
          { level: 40, msg: "", time: undefined },
        ],
      }),
    ).toBe("warn");
    expect(
      phaseTone({
        phase: "A",
        lines: [
          { level: 40, msg: "", time: undefined },
          { level: 50, msg: "", time: undefined },
          { level: 30, msg: "", time: undefined },
        ],
      }),
    ).toBe("error");
  });

  it("treats an empty phase as info", () => {
    expect(phaseTone({ phase: "A", lines: [] })).toBe("info");
  });
});

describe("phaseLabel", () => {
  it("turns EAS's SCREAMING_SNAKE phases into a sentence", () => {
    expect(phaseLabel("SPIN_UP_BUILDER")).toBe("Spin up builder");
    expect(phaseLabel("INSTALL_DEPENDENCIES")).toBe("Install dependencies");
    expect(phaseLabel("XCODE")).toBe("Xcode");
  });

  it("passes through a shape it does not recognise", () => {
    expect(phaseLabel("")).toBe("");
    expect(phaseLabel("   ")).toBe("   ");
  });
});

describe("firstLine", () => {
  it("takes the commit subject, not the body", () => {
    expect(firstLine("feat: a thing\n\nlong body here")).toBe("feat: a thing");
  });

  it("skips leading blank lines", () => {
    expect(firstLine("\n\n  real subject\nmore")).toBe("real subject");
  });

  it("is undefined for nothing to show", () => {
    expect(firstLine(undefined)).toBeUndefined();
    expect(firstLine("")).toBeUndefined();
    expect(firstLine("\n  \n")).toBeUndefined();
  });
});

describe("shortCommit", () => {
  it("shortens to the usual seven characters", () => {
    expect(shortCommit("1234567890abcdef")).toBe("1234567");
  });

  it("leaves a already-short hash alone and skips blanks", () => {
    expect(shortCommit("abc")).toBe("abc");
    expect(shortCommit(undefined)).toBeUndefined();
    expect(shortCommit("   ")).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("renders seconds, minutes and hours", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(83_000)).toBe("1m 23s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(7_500_000)).toBe("2h 5m");
    expect(formatDuration(7_200_000)).toBe("2h");
  });

  it("is undefined for a missing or nonsensical metric", () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(-1)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
  });

  it("renders zero rather than dropping it", () => {
    expect(formatDuration(0)).toBe("0s");
  });
});

describe("relativeTimeOf", () => {
  it("formats a real ISO timestamp", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(relativeTimeOf(twoHoursAgo)).toBe("2h ago");
  });

  it("is undefined for a missing or unparseable timestamp", () => {
    expect(relativeTimeOf(undefined)).toBeUndefined();
    expect(relativeTimeOf("not a date")).toBeUndefined();
  });
});

describe("urls", () => {
  it("builds each endpoint off the backend base", () => {
    expect(buildsUrl("http://host:5195")).toBe("http://host:5195/builds");
    expect(buildDetailUrl("http://host:5195", "abc")).toBe("http://host:5195/builds/abc");
    expect(buildLogsUrl("http://host:5195", "abc")).toBe("http://host:5195/builds/abc/logs");
  });

  it("tolerates a trailing slash on the base", () => {
    expect(buildsUrl("http://host:5195/")).toBe("http://host:5195/builds");
    expect(buildDetailUrl("http://host:5195///", "abc")).toBe("http://host:5195/builds/abc");
  });

  it("escapes the id rather than letting it alter the path", () => {
    expect(buildDetailUrl("http://h", "a/../b")).toBe("http://h/builds/a%2F..%2Fb");
    expect(buildLogsUrl("http://h", "a b")).toBe("http://h/builds/a%20b/logs");
  });
});

describe("httpErrorMessage", () => {
  it("prefers the backend's own { error } body", () => {
    expect(httpErrorMessage(404, JSON.stringify({ error: "Build not found" }))).toBe("Build not found");
  });

  it("also reads a { message } body", () => {
    expect(httpErrorMessage(500, JSON.stringify({ message: "boom" }))).toBe("boom");
  });

  it("falls back to the status when the body is not usable", () => {
    expect(httpErrorMessage(502, "<html>Bad Gateway</html>")).toBe("The server answered 502.");
    expect(httpErrorMessage(500, "")).toBe("The server answered 500.");
    expect(httpErrorMessage(404, JSON.stringify({ error: "  " }))).toBe("The server answered 404.");
  });
});

describe("tailLines", () => {
  it("keeps everything when the phase is under the limit", () => {
    expect(tailLines([1, 2, 3], 500)).toEqual({ lines: [1, 2, 3], hidden: 0 });
    expect(tailLines([], 500)).toEqual({ lines: [], hidden: 0 });
  });

  it("keeps the tail, not the head — the failure is at the end of a phase", () => {
    expect(tailLines([1, 2, 3, 4, 5], 2)).toEqual({ lines: [4, 5], hidden: 3 });
  });

  it("keeps exactly the limit with nothing hidden at the boundary", () => {
    expect(tailLines([1, 2, 3], 3)).toEqual({ lines: [1, 2, 3], hidden: 0 });
  });

  it("reports everything hidden for a nonsensical limit", () => {
    expect(tailLines([1, 2, 3], 0)).toEqual({ lines: [], hidden: 3 });
    expect(tailLines([1, 2, 3], -1)).toEqual({ lines: [], hidden: 3 });
  });
});
