import { describe, expect, it } from "vitest";
import { pageViewUrl, parseBridgeMessage, parseDaLink } from "./projectsClient";

describe("pageViewUrl", () => {
  it("renders for the app, with the slugs escaped", () => {
    expect(pageViewUrl("http://mac:5199/", "printing", "home")).toBe("http://mac:5199/projects/view?project=printing&slug=home&env=app");
    expect(pageViewUrl("http://mac:5199", "a b", "c/d")).toBe("http://mac:5199/projects/view?project=a%20b&slug=c%2Fd&env=app");
  });
});

describe("parseDaLink", () => {
  it("reads a page link", () => {
    expect(parseDaLink("da:page:printing:home")).toEqual({ kind: "page", project: "printing", slug: "home" });
  });
  it("reads a session link", () => {
    expect(parseDaLink("da:session:ses_123")).toEqual({ kind: "session", sessionID: "ses_123" });
  });
  it("reads a file link, keeping the colons in the path", () => {
    expect(parseDaLink("da:file:hyperlink:src/a:b.ts")).toEqual({ kind: "file", repo: "hyperlink", path: "src/a:b.ts" });
  });
  it("is undefined for anything else", () => {
    expect(parseDaLink("https://example.com")).toBeUndefined();
    expect(parseDaLink("da:page:only-project")).toBeUndefined();
    expect(parseDaLink("da:nothing:x")).toBeUndefined();
  });
});

describe("parseBridgeMessage", () => {
  it("decodes the SDK's messages", () => {
    expect(parseBridgeMessage(JSON.stringify({ type: "navigate", href: "da:page:p:s" }))).toEqual({ type: "navigate", href: "da:page:p:s" });
    expect(parseBridgeMessage(JSON.stringify({ type: "chrome", mode: "fullscreen" }))).toEqual({ type: "chrome", mode: "fullscreen" });
    expect(parseBridgeMessage(JSON.stringify({ type: "context", context: { page: "x" } }))).toEqual({ type: "context", context: { page: "x" } });
  });
  it("is undefined for anything that is not ours", () => {
    expect(parseBridgeMessage("not json")).toBeUndefined();
    expect(parseBridgeMessage(JSON.stringify({ type: "chrome", mode: "huge" }))).toBeUndefined();
    expect(parseBridgeMessage(JSON.stringify({ type: "other" }))).toBeUndefined();
  });
});
