import { describe, expect, it } from "vitest";
import { skillPlace } from "./skillPlace";

const noRepo = () => undefined;

describe("skillPlace", () => {
  it("opens a home skill in its agent folder, not its own", () => {
    expect(skillPlace("/Users/me/.claude/skills/unslop/SKILL.md", "~/Coding", noRepo)).toEqual({ repo: ".claude", dir: "/Users/me/.claude" });
    expect(skillPlace("/Users/me/.config/opencode/skill/x/SKILL.md", "~/Coding", noRepo)).toEqual({ repo: "opencode", dir: "/Users/me/.config/opencode" });
  });

  it("opens a project's own skill in its repo", () => {
    const repoOf = (folder: string) => (folder.startsWith("/Users/me/Coding/app/") ? { repo: "app", dir: "/Users/me/Coding/app" } : undefined);
    expect(skillPlace("/Users/me/Coding/app/.claude/skills/lint/SKILL.md", "~/Coding", repoOf)).toEqual({ repo: "app", dir: "/Users/me/Coding/app" });
  });

  it("falls back to the server's root folder, then the skill's own", () => {
    expect(skillPlace("/Users/me/Coding/notes/SKILL.md", "~/Coding", noRepo)).toEqual({ repo: "Coding", dir: "~/Coding" });
    expect(skillPlace("/opt/skills/x/SKILL.md", "~/Coding", noRepo)).toEqual({ repo: "x", dir: "/opt/skills/x" });
  });
});
