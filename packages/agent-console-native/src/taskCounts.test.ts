import { describe, expect, it } from "vitest";
import { countByKind, kindOf } from "./taskCounts";
import { githubRepoFromRemoteUrl } from "./repoScan";

const issue = (labels: ReadonlyArray<string>, type?: string) => ({
  number: 1,
  labels: labels.map((name) => ({ name })),
  ...(type === undefined ? {} : { type: { name: type } }),
});

describe("kindOf", () => {
  it("takes the issue type first", () => {
    expect(kindOf(issue(["bug"], "Feature"))).toBe("Feature");
  });
  it("falls back to GitHub's default labels", () => {
    expect(kindOf(issue(["Bug"]))).toBe("Bug");
    expect(kindOf(issue(["enhancement"]))).toBe("Feature");
  });
  it("is a Task otherwise", () => {
    expect(kindOf(issue([]))).toBe("Task");
    expect(kindOf({ number: 1, labels: [], type: null })).toBe("Task");
  });
});

describe("countByKind", () => {
  it("counts issues by kind, most first, leaving out pull requests", () => {
    expect(countByKind([issue(["bug"]), issue([]), issue(["bug"]), { ...issue([]), pull_request: {} }])).toEqual([
      { kind: "Bug", count: 2 },
      { kind: "Task", count: 1 },
    ]);
  });
});

describe("githubRepoFromRemoteUrl", () => {
  it("reads https and ssh remotes", () => {
    expect(githubRepoFromRemoteUrl("https://github.com/nikolasstow/Hyperlink.git")).toEqual({ owner: "nikolasstow", name: "Hyperlink" });
    expect(githubRepoFromRemoteUrl("git@github.com:nikolasstow/Hyperlink.git")).toEqual({ owner: "nikolasstow", name: "Hyperlink" });
  });
  it("is nothing off GitHub", () => {
    expect(githubRepoFromRemoteUrl("https://gitlab.com/a/b.git")).toBeUndefined();
  });
});
