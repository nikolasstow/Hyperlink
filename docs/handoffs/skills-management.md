# Skills (and rules) management — grounded design

**Status:** DESIGN, grounded against OpenCode's actual source (the shipped binary). Not built. Owner-driven. The composer-attachments UI is explicitly **discuss-before-building**.
**Related:** `rules-app-integration.md` (rules/standards surface), `assistant-and-bottom-bar.md`, `extensions-sync-and-theming.md`.

## How OpenCode skills actually work (verified from source)

- A **skill = a `SKILL.md` file** (`{ name, description, slash, location, content }`), auto-**discovered** from default dirs (global `~/.claude/skills/`, project skill dirs, built-ins) and optional `config.skills.paths`/`urls`. `GET /skill` lists them (verified live: `unslop` from `~/.claude/skills/unslop`, `customize-opencode` built-in).
- Discovered skills are advertised to the model in the **system prompt** as `<available_skills>` (name + description) with: *"Use the skill tool to load a skill when a task matches its description."* → **the model auto-loads a skill when the task matches** (no user `/` needed).
- Loading is a **`skill` tool call** (a first-class tool alongside read/edit/bash/task/lsp — "Load a skill by name"). Its `execute`:
  - runs a **per-skill permission ask**: `t.ask({ permission: "skill", patterns: [name], always: [name] })`,
  - returns the SKILL.md as a tool output: `<skill_content name=…>{content}…<skill_files>…`.
- **Availability is filtered by permission, by name:** `Skill.available = skills.filter(s => permission.evaluate("skill", s.name, perms).action !== "deny")`. A denied skill is **stripped from the system prompt** (the model never sees it). `permission.skill` is `"ask" | "allow" | "deny"` or a per-name object.
- **Config is cached per session.** OpenCode's own guidance: *"running sessions keep using the already-loaded config… restart for changes to take effect."* So config-level changes (permission, `skills.paths`, rules/instructions) affect **new** sessions, not running ones.
- OpenCode sorts skills **alphabetically** — it has **no order concept**; any ordering is our UI's.

### The three (+one) states

- **off** — `permission.skill: { name: "deny" }` → stripped from availability; model can't see or use it.
- **available** — advertised; the model auto-loads on description match; each load hits a permission **ask** (approve/deny, "always allow this one").
- **called** — loaded; `<skill_content>` injected into the conversation; applies from that point and **persists in context until it ages out** (compaction/truncation) — not pinned.
- **sticky (whole-session)** — *not a skill state.* Always-on behavior (e.g. formatting) belongs in a **rule/instruction** (always in the system prompt), which is the reliable "whole session" mechanism. Reminders were rejected as the weak version. "Sticky" = promote to a rule.

## What we build (it's ours — OpenCode has no per-session skill toggle)

Enable/disable is entirely our layer, over the permission axis:

- **Gate + ask-to-approve is native and feasible** (owner's wish): set the skill's permission to `"ask"` → OpenCode raises a permission request the app **already intercepts** (`sessionPermissions.ts` — permission mode), and the app allows/denies per its own state. `deny` = hard off (stripped from prompt).
- **Per-scope (root/repo)** off = write `permission.skill` in that scope's config (new sessions).
- **Per-session** on/off = the app auto-allows/denies the skill's load ask against a per-session set — the only lever that's **live** mid-session, because config changes need a restart. A new session is **seeded with its parent scope's enabled set** (owner requirement); existing sessions are untouched.
- **We can observe which skills a session used** — the `skill` load is a tool call in the transcript (ToolPart, `tool: "skill"`, renders as "Called skill"). No need to ask the model. Powers the "Disable in N sessions" count.
- Honest caveat: per-session "off" via app-deny gates **execution**; the model still sees the skill in the prompt (may try, gets denied). A true prompt-strip is scope-level only.

## Shared live-control channel (skills + rules)

Because config is frozen per session, live mid-session control uses a **per-turn `<system-reminder>`** — a channel OpenCode's base prompt already declares authoritative ("`<system-reminder>` tags contain useful information… not part of the user's message"):

- **Protocol stated once** (a single app-owned always-on instruction): "a `<system-reminder>` may carry `disabled` / `locked` lists; suspend rules/skills named in `disabled`; never suspend `locked` ones."
- **State per turn**: the reminder carries only the live lists (ids). Cheap, live, re-asserted every turn so it out-weighs the frozen system prompt.
- **Rules** default hard-always-on (config-cached); the reminder adds an opt-in **soft-suspend**; **locking = withholding that opt-in at/above a scope** (root > repo > session). Enforced app-side (won't emit a disable) + prompt-side (protocol says ignore disables for locked).

## UI plan (per earlier owner notes — parts still open)

- **Settings pages** at repo/folder and session level. Combined single list of skills (installed here + elsewhere), "Create/import" later.
- **Per-message model** (owner's framing, matches the engine): toggling a skill on/off attaches a **skill-call** or a **soft-disable** to the *next message* — surfaced in the composer **attachments UI** (⚠️ **discuss before building** — owner asked to hold on that UI).
- Long-press cross-session controls (Disable/Enable in N sessions), export as `.md`, Siri/Shortcuts to toggle — later phases.
- Rules feature is the sibling surface — see `rules-app-integration.md`.

## Open

- The composer attachments UI (hold for discussion).
- Where per-scope/per-session enabled state is stored (our synced config vs local) and how the seed-on-new-session is applied (invoke vs control-block).
- Whether to expose "convert skill → rule" (promote to always-on).
