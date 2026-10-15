# Slash commands in the composer

Started 2026-10-14 (owner + Claude, eta worktree). Typing `/` in a composer lists what can be run
by name (skills, commands, MCP prompts, opencode's built-ins), filtered as you type.

Related: `dubz-suggestions-decisions.md` (suggestions without `/`, through Laya),
`skills-management.md` (turning skills on and off), `agent-console-native-composer.md`.

---

## Locked (owner-stated)

- **The list is opencode's own.** Version 1 lists what opencode lists: its built-in commands, your
  commands, MCP prompts and skills. Package scripts, git and other token-free tools join later
  (`dubz-suggestions-decisions.md` step 1). (owner, 10-14)
- **Space accepts the suggestion.** While a `/` word is typed, space accepts the top match:
  `/re` + space gives `/review ` with the cursor after it. Space after an exact name only goes on,
  and with no match (or a bare `/`) it is a plain space. (owner, 10-14)
- **Who builds what.** eta builds the catalog, its preloading, the send path and the chat
  composer's list; epsilon puts the same list into Dubz. (owner, 10-14)

## Proposed (not approved)

- **Preloaded, kept on the device.** The list is read per server and folder at app open and on
  return to the foreground, kept on the device (an Effect `CommandCatalog` service:
  SubscriptionRef + KeyValueStore + Schema, mirrored to React). Typing `/` only filters it.
- **Rows** show the name, the description, where it comes from (skill, command, MCP, built-in) and
  the argument hint opencode gives (`$ARGUMENTS`, `$1`).
- **The accepted word is coloured** with the theme's `chat.slashCommandBackground` and
  `chat.slashCommandForeground` (VS Code's keys for this, already in `themeColorKeys.ts`).
- **Rows use the tool record** of `dubz-suggestions-decisions.md` P5, so Laya can rank the same
  entries later and the `/` list can sort by context.

## Found in opencode (2026-10-14)

- **Listing.** v1 `GET /command?directory=…` returns everything: `{ name, description, source:
  "command" | "mcp" | "skill", agent, subtask, hints }` (18 for this repo: `init`, `review`, 16
  skills). v2 `GET /api/command` exists but is experimental and returns nothing today.
- **Running.** Only v1 runs one: `POST /session/:id/command` with `{ command, arguments, agent?,
  model?, parts? }`. opencode then fills the template (`$1`, `$ARGUMENTS`), runs its shell
  substitutions, switches to the command's agent or makes it a subtask, and loads the skill.
- **The app sends through v2** (`/api/session/:id/prompt`, `delivery: "queue"`, its own message
  ids, exactly once, through the outbox). v2 has no way to run a command, and v1 does not see v2
  sessions. This is the open question below.

## Upstream opencode (checked 2026-10-14)

Our server runs `v1.18.33` plus two patches (2026-09-30). Upstream `dev` is 647 commits on and
releases as `v2.0.29`:

- **v2 runs commands now.** `POST /api/session/:id/command` takes `{ name, …prompt, delivery? }`
  (no message id); skills are their own list (`GET /api/skill`) and are turned on per session with
  `POST /api/experimental/session/:id/skill`. `Command.Info` is only `{ name, description }`.
- **v1 is gone.** No v1 routes remain; `packages/opencode` is split into `server`, `core`, `cli`
  and others, with a v1-to-v2 database migration (`core/database/v1-migration`).
- **Our first patch is upstream** (providers reload when the models catalog refreshes). The
  `POST /provider/refresh` endpoint is not.
- **Our app still uses v1** in many places: the `@opencode-ai/sdk` v1 client (17 files across the
  native app and agent-console: session lists, the chat stream, worktrees, previews), v1 lanes in
  the outbox, and its vendored v2 API is the v1.18.33 one.

## Open

1. **How a command runs on a v2 session.** Options:
   - **Add it to opencode's v2** (we run a patched opencode): a command in the v2 prompt, queued
     like any message. Clean, keeps the outbox's ordering and exactly-once. Needs the opencode
     server on `:4096` restarted, which is shared with epsilon.
   - **Fill the template in our server** and send it as a plain v2 prompt. Loses the agent switch,
     subtasks and shell substitutions; a copy of opencode's logic.
   - **Send `/name args` as text** and let the model load the skill. Unreliable; skills only.
