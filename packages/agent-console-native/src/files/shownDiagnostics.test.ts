import type { Language } from "agent-console-protocol";
import { describe, expect, it } from "vitest";
import { shownDiagnostics } from "./shownDiagnostics";

const base = 'const a = 1;\nconst bad: number = "x";\n';
const at = (text: string, word: string): Language.Diagnostic => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length, severity: "error", message: "m" });

describe("shownDiagnostics", () => {
  it("leaves them alone when nothing is unsaved", () => {
    const found = [at(base, "bad")];
    expect(shownDiagnostics(found, base, base)).toBe(found);
  });

  it("moves them past an unsaved edit above, and keeps them on their word", () => {
    const text = `// a note\n${base.replace("1", "12345")}`;
    const [moved] = shownDiagnostics([at(base, "bad")], base, text);
    expect(text.slice(moved?.start ?? 0, moved?.end ?? 0)).toBe("bad");
  });

  it("leaves one before an unsaved edit where it is", () => {
    const text = base.replace('"x"', '"xyz"');
    const [kept] = shownDiagnostics([at(base, "bad")], base, text);
    expect(text.slice(kept?.start ?? 0, kept?.end ?? 0)).toBe("bad");
  });
});
