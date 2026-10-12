import { FileSync, TextChange } from "file-sync";
import { describe, expect, it } from "vitest";
import * as LiveFile from "./liveFile";

const original = ["import a", "", "const x = 1", "const y = 2", ""].join("\n");

const synced = (text: string, version = 0) =>
  new FileSync.Synced({
    epoch: "e1",
    version,
    text,
  });

const agentChange = (before: string, after: string, version: number) =>
  new FileSync.Changed({
    version,
    changes: TextChange.diff(before, after),
    author: new FileSync.Agent({ sessionID: "ses_1" }),
  });

const open = (kept: LiveFile.Kept = { base: undefined, edit: undefined }) => LiveFile.synced(undefined, kept, synced(original)).file;

describe("liveFile", () => {
  it("takes the hub's text when nothing is kept", () => {
    const { file, editor } = LiveFile.synced(undefined, { base: undefined, edit: undefined }, synced(original));
    expect(file.text).toBe(original);
    expect(file.base).toBe(original);
    expect(editor).toBeUndefined();
  });

  it("applies an agent's change to an untouched file and lights its line", () => {
    const after = original.replace("const y = 2", "const y = 3");
    const received = LiveFile.changed(open(), agentChange(original, after, 1), "me");
    expect(received?.file.text).toBe(after);
    expect(received?.file.version).toBe(1);
    expect(received?.editor?.text).toBe(after);
    expect(TextChange.apply(original, received?.editor?.changes ?? [])).toBe(after);
    const [lit] = received?.editor?.highlights ?? [];
    expect(after.slice(lit.from, lit.to)).toBe("const y = 3");
  });

  it("keeps my typing on another line when an agent changes the file", () => {
    const typed = LiveFile.edited(open(), original.replace("const x = 1", "const x = 10"));
    const after = original.replace("const y = 2", "const y = 3");
    const received = LiveFile.changed(typed, agentChange(original, after, 1), "me");
    expect(received?.file.text).toBe(original.replace("const x = 1", "const x = 10").replace("const y = 2", "const y = 3"));
    expect(received?.file.base).toBe(after);
    expect(received?.file.conflicts).toEqual([]);
    expect(LiveFile.pendingWrite(received?.file ?? typed)).toEqual(TextChange.diff(after, received?.file.text ?? ""));
  });

  it("keeps the agent's line and holds mine as a conflict when we both changed it", () => {
    const typed = LiveFile.edited(open(), original.replace("const y = 2", "const y = 20"));
    const after = original.replace("const y = 2", "const y = 3");
    const received = LiveFile.changed(typed, agentChange(original, after, 1), "me");
    if (received === undefined) return expect(received).toBeDefined();
    expect(received.file.text).toBe(after);
    const [conflict] = received.file.conflicts;
    expect(after.slice(conflict.from, conflict.to)).toBe("const y = 3");
    expect(conflict.mine).toBe("const y = 20");

    const mine = LiveFile.resolve(received.file, 0, "Mine");
    expect(mine.file.text).toBe(original.replace("const y = 2", "const y = 20"));
    expect(mine.file.conflicts).toEqual([]);
    expect(mine.editor?.highlights).toEqual([]);
    const both = LiveFile.resolve(received.file, 0, "Both");
    expect(both.file.text).toBe(original.replace("const y = 2", "const y = 20\nconst y = 3"));
    expect(both.file.conflicts).toEqual([]);
    const theirs = LiveFile.resolve(received.file, 0, "Theirs");
    expect(theirs.file.text).toBe(after);
    expect(theirs.file.conflicts).toEqual([]);
    expect(theirs.editor).toBeUndefined();
  });

  it("moves a conflict along as I type above it", () => {
    const typed = LiveFile.edited(open(), original.replace("const y = 2", "const y = 20"));
    const after = original.replace("const y = 2", "const y = 3");
    const received = LiveFile.changed(typed, agentChange(original, after, 1), "me");
    if (received === undefined) return expect(received).toBeDefined();
    const more = LiveFile.edited(received.file, `// header\n${received.file.text}`);
    const [conflict] = more.conflicts;
    expect(more.text.slice(conflict.from, conflict.to)).toBe("const y = 3");
  });

  it("takes our own write coming back without touching the text", () => {
    const typed = LiveFile.edited(open(), `${original}more`);
    const echo = new FileSync.Changed({
      version: 1,
      changes: LiveFile.pendingWrite(typed),
      author: new FileSync.Client({ clientID: "me" }),
    });
    const received = LiveFile.changed(typed, echo, "me");
    expect(received?.editor).toBeUndefined();
    expect(received?.file.base).toBe(`${original}more`);
    expect(LiveFile.pendingWrite(received?.file ?? typed)).toEqual([]);
  });

  it("ignores a change it already has and asks to resync after a gap", () => {
    const file = LiveFile.changed(open(), agentChange(original, "x", 1), "me")?.file;
    if (file === undefined) return expect(file).toBeDefined();
    expect(LiveFile.changed(file, agentChange(original, "x", 1), "me")?.file).toBe(file);
    expect(LiveFile.changed(file, agentChange("x", "y", 3), "me")).toBeUndefined();
  });

  it("an accepted write moves the base; a late echo after it changes nothing", () => {
    const typed = LiveFile.edited(open(), `${original}more`);
    const changes = LiveFile.pendingWrite(typed);
    const written = LiveFile.accepted(typed, changes, 1);
    expect(written.base).toBe(`${original}more`);
    const echo = new FileSync.Changed({
      version: 1,
      changes,
      author: new FileSync.Client({ clientID: "me" }),
    });
    expect(LiveFile.changed(written, echo, "me")?.file).toBe(written);
  });

  it("on reconnect, rebases an edit kept on the device onto what the hub has now", () => {
    const kept = {
      base: original,
      edit: original.replace("import a", "import aa"),
    };
    const now = original.replace("const y = 2", "const y = 9");
    const { file, editor } = LiveFile.synced(undefined, kept, synced(now, 4));
    expect(file.text).toBe(now.replace("import a", "import aa"));
    expect(file.base).toBe(now);
    expect(file.version).toBe(4);
    expect(editor?.text).toBe(file.text);
  });

  it("marks a deletion and keeps our text", () => {
    const typed = LiveFile.edited(open(), "draft");
    const gone = LiveFile.deleted(typed, new FileSync.Deleted({ version: 1 }));
    expect(gone.deleted).toBe(true);
    expect(gone.text).toBe("draft");
  });
});
