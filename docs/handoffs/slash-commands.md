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

## Approved (owner, 2026-10-15)

- **Preloaded, kept on the device.** The list is read per server and folder at app open and on
  return to the foreground, kept on the device (an Effect `CommandCatalog` service:
  SubscriptionRef + KeyValueStore + Schema, mirrored to React). Typing `/` only filters it.
- **Rows** show the name, the description, where it comes from (skill, command, MCP, built-in) and
  the argument hint opencode gives (`$ARGUMENTS`, `$1`).
- **The accepted word is coloured** with the theme's `chat.slashCommandBackground` and
  `chat.slashCommandForeground` (VS Code's keys for this, already in `themeColorKeys.ts`).
- **Rows use the tool record** of `dubz-suggestions-decisions.md` P5, so Laya can rank the same
  entries later and the `/` list can sort by context.

## Asked (owner, 2026-10-15, after first build)

- **Return accepts too**, like space.
- **The accepted `/name` is glass**, not a plain background: a glass chip at the start of the input,
  and the same chip at the start of the sent message (skill or command). Built: the chip is tinted
  with `chat.slashCommandBackground`, its text `chat.slashCommandForeground`. In the input it is a
  token (backspace on empty text removes it); in the bubble it sits above the text, outside the
  text's arrival transform (glass dies under a transform).
- **Commands in the sent message:** a command's message comes back from opencode as the command's
  prompt (its template filled in), under a new id, with nothing marking it as a command. The queued
  bubble shows the chip until the server takes it; the server's message then shows the prompt,
  without a chip. Open: see below.
  **Decided (owner left it to Claude, 2026-10-15): option 1.** When the outbox runs a command it
  reads the session's user messages (inbox and newest) before and after; the one new message is the
  command's, kept on the device as typed (`commands/CommandEchoes.ts`), and the chat shows it with
  its chip and arguments (`chat/withEchoes.ts`). None or more than one new (another device sending
  at the same moment): nothing is marked, and a warning is logged. The real fix is for opencode to
  stamp a command's message with its name and arguments; to propose upstream on the owner's go.

## Skill chips (owner, 2026-10-15)

The session's active skills sit in the chat's chip row beside its files, and behave like file chips:

- **Typing (input open):** a tap selects the skill; it goes with the next message as a skill
  attachment. A reminder: sending it again freshens it in the context.
- **Not typing:** a tap opens the skill's file (`SKILL.md`) in Files, to read or edit it (live
  sync; opencode reloads an edited skill, and the list follows its `skill.updated`). A skill built
  into opencode (`opencode`, `report`) has no file: its description shows instead.
- **Which are active:** the skills you sent (a leading `/skill`, or a chip) and the ones the agent
  loaded (its `skill` tool). opencode keeps an active skill in the context (compaction too), so
  there is no off switch.
- **Sent message:** every skill it carried shows as a glass chip, the leading `/name` first.

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

## On v2 (2026-10-15, after the cutover)

What opencode v2 gives, checked on the shared server:

- **Commands:** `GET /api/command` → `{ name, description? }`. No source, no argument hint, and no
  built-ins (v1's `init` and `review` are gone). The server has none today.
- **Skills:** `GET /api/skill` → `{ id, name, description?, path, content, … }`, read from
  `~/.claude/skills`, `~/.agents/skills`, the config folders and the project's `.claude` /
  `.agents` / `.opencode`. 17 today. The full list is ~196 KB per folder (every skill's text).
- **A folder's first answer is incomplete.** opencode starts a folder on first use and loads its
  skills a moment later: the first `GET /api/skill` gave 0, then 17 after 0.3 s. When they land it
  sends `command.updated` and `skill.updated` with `location.directory`.
- **Running:** a command is `POST /api/session/:id/command` `{ name, text, …, delivery }` (no
  message id). A skill is not a command in v2: it is an attachment on a normal prompt
  (`skills: [{ id, mention: { start, end, text } }]`); opencode's own TUI lists skills under `@`.

## Built this way (Claude, 2026-10-15)

- **Catalog on the server**, like the model catalog: `GET /commands?directory=…`
  (`agent-console-protocol` `Commands`) reads both lists and sends only what a row needs: id
  (`skill:<id>`, `command:<name>`), name, description and source. Skill text stays on the server.
- **`CommandCatalog` on the app**, like `ModelCatalog`: kept on the device by folder, read back at
  launch, loaded again at app open and on return to the foreground, and loaded again for a folder
  when opencode sends `command.updated` or `skill.updated` for it (which fixes the incomplete first
  answer).
- **One `/` list** (owner's rule): commands and skills together, source shown on the row.
- **Sending:** `/<skill> text` goes through the outbox as a normal message with the skill attached
  (mention over `/<skill>`), so ordering and exactly-once hold. `/<command> args` goes through the
  outbox too and runs with `session.command`. That route takes no message id: a retry after a
  lost answer can run the command twice.

## Open

1. **How a command runs on a v2 session.** Settled by the move to v2 (`session.command`, above).
   The options were:
   - **Add it to opencode's v2** (we run a patched opencode): a command in the v2 prompt, queued
     like any message. Clean, keeps the outbox's ordering and exactly-once. Needs the opencode
     server on `:4096` restarted, which is shared with epsilon.
   - **Fill the template in our server** and send it as a plain v2 prompt. Loses the agent switch,
     subtasks and shell substitutions; a copy of opencode's logic.
   - **Send `/name args` as text** and let the model load the skill. Unreliable; skills only.
