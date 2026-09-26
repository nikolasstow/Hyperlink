# Dubz suggestions: decisions doc

Started 2026-09-25 (owner + Claude, epsilon worktree). Scope: tool suggestions in the Dubz pane,
the tool catalog they draw from (VS Code extensions, package scripts, built-ins, skills), how each
tool is found, run and configured, and how Laya picks among them.

**Status.** The *Locked* section is owner-stated. Everything under *Proposed* is Claude's design
and is not binding until the owner approves it row by row. Measurements are in *Evidence*, with the
scripts that produced them.

Related: `extensions-sync-and-theming.md` (the extension store this builds on),
`files-explorer-spec.md` (the file context the pane reads), `packages/agent-console-native/src/Dubz.tsx`
(the pane, currently an empty glass shell).

---

## What it is

Dubz is the app-wide assistant window. As you type in it, Laya reads what you typed together with
what is on screen (the open file, its repo, related sessions, what you did last) and suggests the
tools that match. Tapping a suggestion runs that tool directly, with no language model and no
tokens. Hitting send goes to the Dubz agent as a message, as it does today.

Example: a file is open and you type `format this`. Laya picks Prettier (from the installed
Prettier extension) and shows it with a play button. Tap play and the file is formatted. Hit send
instead and the agent gets the message, probably runs the same formatter, and spends tokens doing
it.

---

## Locked (owner-stated)

- **Laya is the dispatcher, not the judge.** Laya picks the right tool; the tools do the work and
  the checking. A tool can be anything: a formatter, a script, a linter, more Laya questions, or the
  agent. Tuning means tuning *how we use* Laya (questions, context, thresholds), not training it.
  (owner, 09-25)
- **Laya runs locally.** It is free to run, so it can run as often as it helps, including on every
  keystroke. (owner, 09-25)
- **Suggestions come from typed text plus screen context.** Context includes the file on screen and
  its repo, the text typed so far (before send), which sessions are related and how, and other
  things you might do to that file. (owner, 09-25)
- **One suggestion unless the top scores are close.** Show more than one option only when the
  confidence scores are close together. (owner, 09-25)
- **Long press previews, play runs.** iOS's long/hard press shows a preview of what a suggestion
  would do. Simple actions such as running a tool get a play button. (owner, 09-25)
- **Chained requests become a checklist.** For input like `format and build then commit and push`,
  recognise every tool call and its order, and show them as a list. Every row is pre-checked and has
  its own play button. A **Run** button at the bottom runs everything checked, in order.
  (owner, 09-25)
- **Send always means the agent.** Hitting send sends the message to the Dubz agent, a language
  model, which would likely run the same tools but costs tokens. Suggestions are the token-free
  path; send is never repurposed. (owner, 09-25)
- **A tool's needs decide what a tap passes.** Prettier needs only the open file; other tools need
  the typed text as input. (owner, 09-25)
- **Tools come from several sources.** VS Code extensions (Prettier), npm (package.json scripts and
  the other things the npm extension offers), and other tools such as skills. A skill is run by the
  Dubz agent. (owner, 09-25)
- **Extensions are scanned for everything usable.** For each extension, find everything it can do
  that we can use and how to run it, and turn all of it into tools Laya can choose from.
  (owner, 09-25)
- **Laya trims what the agent sees.** When a message is sent, Laya can attach the recommended tools
  as context, so the model does not need every tool in its context. (owner, 09-25)
- **Everything is configurable.** Settings can turn features like this off, disable the tools from
  one extension, and hold other configuration options. (owner, 09-25)

---

## Evidence

All numbers are from this Mac (M4, 24 GB) on 2026-09-25, Laya 0.3.20, PyTorch 2.14 on the Apple
GPU (`mps`), warm. The scripts live in `~/Coding/laya` (outside the repo for now, see *Open
questions*).

### Speed (`bench.py`)

| Device | Median | p95 | Load |
|---|---|---|---|
| Apple GPU (`mps`) | 161 ms | 166 ms | under 1 s from cache |
| CPU | 419 ms | 496 ms | under 1 s from cache |

That is four questions per call over a routing-sized input. The model card's 33 ms is a desktop
NVIDIA T4. The suggestion calls below are shorter and run at about 77 to 80 ms.

### Laya cannot judge code rules (`eval_rules.py`, `eval_routing.py`)

The ✅ / ❌ examples in `docs/standards` give 47 rules and 52 labelled pairs, extracted
automatically by `extract_pairs.py`, so the set follows the docs.

- **As a rule checker**, the best question design ranked the ❌ example above the ✅ one 65% of the
  time (chance is 50%). Six designs were tried: yes/no both ways round, follows-or-breaks choice,
  `text` versus `code` state, and both checkpoints.
- **As a router to a rule chapter**, it was right first time 25% of the time (chance 17%) and sent
  most code to *effect-style*, because most of our code looks like Effect code.
- It did separate a prose rule (*no-simply*: 0.95 against 0.11).

Conclusion: Laya reads language, not code structure. Code checks stay with ESLint, the Effect
language service and the markers check. This is why the design below never asks Laya about code
contents, only about what a person asked for.

### Laya picks the right tool from typed text (`probe_dubz.py`)

Nine actions, open file `CodeSurface.tsx`, ten requests.

| Checkpoint | Top-1 | Top-3 | Median |
|---|---|---|---|
| `english` | 8/10 | 9/10 | 80 ms |
| `typed-decisions` | **10/10** | 10/10 | 77 ms |

`format this` → Prettier; `sort the imports` → organise imports; `commit this as …` → commit;
`where else is SurfacePool used` → search. Only `typed-decisions` sent open-ended requests
(`why does the pool …`, `add a retry when …`) to the agent.

**While typing, it guesses early.** `f`, `for` and `form` all went to *search*; Prettier led only
at `format th`, and barely (0.20 against 0.17). The raw scores are low even when right (0.2 to 0.3
on `typed-decisions`), so a fixed cutoff does not work. See *Proposed → When to show*.

### Chains: gate, split, classify (`probe_gate.py`, `probe_chain.py`)

- **Gate.** One `choice` question, *commands or a request?*, classified all 8 test inputs
  correctly on both checkpoints. `english` separates harder: 0.78 to 0.95 for commands, 0.09 to
  0.24 for requests. A second yes/no, *two or more separate commands?*, tells a chain from a single
  command (`format this`: 0.21; chains: 0.81 to 0.93).
- **Split and classify.** Splitting on `and`, `then`, commas and similar, then classifying each
  clause, got every chain right and in order:
  `format and build then commit and push` → Prettier, build, commit, push (260 ms for all four).
- **Why the gate matters.** Without it, `why does the pool lose the ready message and how do I fix
  it` split in two and `how do I fix it` went to ESLint. The gate calls it a request first (0.09),
  so it is never split.

---

## Proposed

Numbered so the owner can approve or strike each one. Nothing here is built.

### P1. The pipeline

On each pause in typing (debounced, about 150 ms), with stale requests cancelled:

1. **Gather context** on the phone (P2).
2. **Filter the catalog** without a model: keep tools that apply to the open file's language and
   path, are enabled in settings, and whose requirements are met on the host that holds the repo
   (P6). This keeps each Laya question to roughly 10 to 15 options.
3. **Gate** (`english`): commands or a request, and one step or several.
4. **Route:**
   - *Request*: no tool suggestion. The send button is the action. Laya's top tools are kept for P8.
   - *One command*: classify against the filtered catalog (`typed-decisions`). Show per P3.
   - *Several commands*: split into clauses, classify each in order, show the checklist (P4).
5. **Return** ranked suggestions with scores and the inputs each one needs (P5).

All Laya calls go through the backend, never from the phone directly (P9).

### P2. Context bundle

What the phone sends with the typed text:

| Field | Source | Why |
|---|---|---|
| `input` | the composer text, unsent | what was asked |
| `file.path`, `file.language` | the open file, if any | language filter, tool inputs |
| `selection` | the code surface's selection | tools that act on a range |
| `repo`, `worktree`, `branch` | the repo screen | where tools run (P6) |
| `relatedSessions` | sessions on this file or branch, with how they relate (same file, same branch, spawned from) | the *open related session* action, and context for the agent |
| `recentActions` | tools run on this file lately | ranking and repeat suggestions |
| `screen` | which screen Dubz opened over | shapes the catalog (a file screen offers file tools) |

The phone sends facts, not interpretations; the backend decides what Laya sees.

### P3. When to show, and how many

A margin rule instead of a fixed threshold, since Laya's scores run low even when correct:

- Show **one** suggestion when the top score beats the runner-up by a clear margin.
- Show **two or three** when the top scores sit close together (owner: *only when close*).
- Show **nothing** while the gate says *request*, or when no tool clears the margin. The send button
  is always there, so showing nothing costs nothing.

The margin value is a tuning parameter per checkpoint, set from logged data (P11), not guessed.

### P4. The chain checklist

Built from the owner's description:

- One row per recognised step, in the order typed, each **pre-checked**.
- Each row has its own **play** button (runs that step alone) and supports **long press** for its
  preview.
- A **Run** button at the bottom runs the checked rows in order.
- **A failed step stops the run.** Later steps stay checked and unrun, and the failure shows on its
  row with its output. Nothing after a failure runs on stale assumptions (pushing after a failed
  build, for example).
- Each row shows the step's status: waiting, running, done, failed.

### P5. What a tool is

Every source is normalised into one record, so Laya, the UI and the runner never care where a
tool came from:

| Field | Meaning |
|---|---|
| `id` | stable, source-prefixed: `ext:esbenp.prettier-vscode/format`, `script:build:dev`, `git:push` |
| `title`, `description` | what Laya reads as the option text, and what the chip shows |
| `source` | extension, package script, built-in, skill, MCP server |
| `appliesTo` | languages and globs (from the extension's `languages` and document selectors) |
| `needs` | what a run needs: nothing, the open file, the selection, the typed text, or a value to extract |
| `effects` | read-only, changes files, changes git history, reaches the network (push, publish) |
| `runner` | how it runs (P7) and where (P6) |
| `preview` | how to preview it: a diff, the command line, a dry-run, or none |
| `enabled` | from settings (P10) |

`effects` drives safety (P12). `needs` drives what a tap passes: a tool whose `needs` includes a
value that the text does not clearly hold (rename: *which* symbol, *what* new name) does not run
blind. Its tap opens Dubz with the tool pre-selected instead.

### P6. Where tools run, and what they need

Tools run on the **host that holds the repo**, never on the phone: today the Mac behind the `:5199`
backend, later whichever node owns that worktree. A tool is offered only when its requirements are
met there:

- **Runtime present**: Node for Prettier and ESLint, the package manager for scripts, git for git.
- **Engine present**: the project's own copy where the extension prefers it (P7).
- **Workspace trusted** where the extension demands it. ESLint declares
  `untrustedWorkspaces: false`: it runs project code (the config file), so an untrusted checkout
  must not get it.
- **Config present** where the tool is meaningless without it (ESLint with no config file).

A tool whose requirements fail is not suggested. Settings can show it greyed out with the reason,
so a missing dependency is visible rather than silent.

### P7. Tool sources, and how each is scanned and run

#### VS Code extensions

The extension store already unzips a `.vsix` and reads `contributes` for themes. Tools need more,
because **an extension's manifest does not list everything it does.** Evidence from the real
packages (Open VSX, 2026-09-25):

- **Prettier** (`esbenp.prettier-vscode` 12.4.0). The manifest declares two commands,
  `prettier.createConfigFile` and `prettier.forceFormatDocument`. Its headline feature, *Format
  Document*, is not a command at all: the code registers it at runtime with
  `registerDocumentFormattingEditProvider` (plus range formatting and a code-actions provider). It
  **bundles Prettier 3.7.4** in its own `node_modules`, and at run time **prefers the project's
  Prettier** (found by walking up to `node_modules`, or the `prettierPath` setting), falling back to
  the bundled copy ("Using bundled version of prettier"). It contributes 35 settings.
- **ESLint** (`dbaeumer.vscode-eslint` 3.0.34). Declares `eslint.executeAutofix` (*Fix all
  auto-fixable Problems*) and five housekeeping commands, plus an `eslint` task type. It is a
  **language server**: the extension is a client (`LanguageClient`) for a bundled
  `server/out/eslintServer.js`, which loads **the project's ESLint**, not a bundled one. 40
  settings.
- **npm** (built into VS Code and Cursor). Declares `npm.runScript`, `npm.runInstall` and related
  commands, and an `npm` task type (`script`, `path`), activated by `workspaceContains:package.json`.
  The scripts themselves are found at runtime by a task provider reading `package.json`.

So the scanner works in layers, each recording what it found and how sure it is:

1. **Manifest.** `contributes.commands`, `taskDefinitions`, `languages`, `configuration`
   (settings, with types and defaults, which become P10's per-extension settings),
   `activationEvents` (when it applies), `capabilities` (trust, virtual workspaces),
   `extensionKind`. Localised titles resolve through `package.nls.json`.
2. **Registrations in the bundle.** Static search of the extension's `main` script for provider
   registrations (`registerDocumentFormattingEditProvider`, `registerCodeActionsProvider`, …).
   Each maps to a standard capability: *format document*, *format selection*, *fix all*,
   *organise imports*. A bundled language client library also contains these names, so this layer
   alone is a hint, not proof.
3. **Engine.** Libraries shipped in the extension's `node_modules` (`prettier`), and the rule for
   choosing between the project's copy and the bundled one.
4. **Language server.** A bundled server script and the `LanguageClient` pattern. A language
   server can be run without VS Code and asked for formatting and code actions (`source.fixAll`)
   over the language server protocol. That makes it the one route that works for many extensions
   without code written for each.

The runners that follow, from most general to most specific:

| Runner | Covers | Cost |
|---|---|---|
| **Language server** | any extension that ships one (ESLint and many others) | one generic client |
| **Engine adapter** | extensions that wrap a library or CLI (Prettier) | a small adapter per engine |
| **Task / script** | task types backed by a command line | generic |
| **Agent** | anything the above cannot run | tokens |

A capability found by the scanner with no runner is **listed, not offered**: settings show it as
*found, not runnable yet*, so the gap is visible. Running extension code itself (a headless VS Code
extension host) would cover everything, but it is heavy and is left as an open question.

#### Package scripts

Read `package.json` directly (the same thing the npm extension's task provider does) for the open
file's package and the repo root. One tool per script, titled from the name (`build:dev`,
`typecheck`, `test`). Run with the package manager the lockfile implies (`pnpm-lock.yaml` → pnpm).
The npm extension's own commands (install, run the script under the cursor) come along as
built-ins. Other task runners the editor recognises (gulp, grunt, make) follow the same pattern
later.

#### Built-ins

Tools the app offers itself: git (commit, push, create a branch), search the repo, open a related
session, TypeScript's organise imports (through the TypeScript language service). These have
hand-written records since they are ours.

#### Skills, and other agent-only tools

A skill is instructions for a model, so it is always run **by the Dubz agent**. It appears as a
suggestion like any other; tapping it sends the input to the agent with that skill named, so the
agent does not have to find it. MCP server tools fit the same slot: listed from the server's own
tool descriptions, run by the agent.

### P8. Recommended tools on sent messages

When a message is sent, the backend attaches Laya's top few tools for that input (ids,
descriptions, how to call them). The agent gets a short, relevant list instead of every tool from
every extension, which keeps its context small and its choice focused. The full catalog stays
reachable (the agent can still ask for any tool), so a wrong pick narrows nothing.

### P9. The Laya service

- **Run Laya's own server.** The `laya` package ships `laya.serve`: `POST /v1/systemone` (the
  TypeSafe Jev wire protocol), `GET /health`, configured by environment variables (`LAYA_PORT`,
  `LAYA_DEVICE`, `LAYA_MODELS`, `LAYA_PRELOAD`, `LAYA_API_KEY`). No custom Python service is needed.
- **Preload** `english` (the gate) and `typed-decisions` (the routing), about 1.2 GB resident,
  device `mps`.
- **The backend owns it.** The `:5199` Effect server calls Laya, builds the catalog, applies the
  margin rule and runs tools. The phone only talks to the backend, as it does for everything else.
- **Where it lives.** A `laya` window in the `doubleagent` tmux session, so it survives reboots with
  the rest (tmux-resurrect).
- **Python.** Homebrew Python 3.14 in a dedicated virtual environment (installed 2026-09-25).

### P10. Settings

> **Superseded in part (2026-09-25):** per-source and per-tool toggles give way to a **Tools
> page** that groups tools by AI and adds them from suggestions across every source, and an
> extension's tools are chosen on its install results screen. See
> `double-agent-repo-screen-and-plugin-system.md` §21.3 and §21.4.

- **Suggestions**: on or off, globally.
- **Per source**: turn off everything from one extension, all package scripts, or all skills.
- **Per tool**: turn off one tool (ESLint's *fix all* without turning off ESLint).
- **Per extension**: its own settings from its manifest's `configuration` (Prettier's 35, ESLint's
  40), shown with their types and defaults.
- **Run policy**: which effects need a confirmation before a play button runs (P12).
- **Agent context**: whether sent messages carry recommended tools (P8).
- **Tuning** (advanced): the margin rule, and which checkpoint does which job.

These sync through the existing config store (`extensions-sync-and-theming.md`), so every device
matches.

### P11. Tuning with data

The margin, the gate and the question wording are tuned from logged outcomes rather than intuition:

- Log each suggestion shown, its scores, and what happened (tapped, ignored, sent instead).
- A tap on a suggestion is a positive label; sending the same text to the agent after ignoring a
  suggestion is a likely negative.
- Replay logs against question-wording variants with the same harness as *Evidence*.

### P12. Safety and failures

- **Changes files** (format, fix): run on play, preview on long press (the diff).
- **Changes git history or reaches the network** (commit, push, publish): never run without a tap
  on that row or on Run. Pre-checking a checklist row is a default, not consent; the tap is.
- **A failed step stops a chain** (P4) and shows its output.
- **No silent failures.** A tool that errors, a Laya call that fails, a runner that is missing: each
  shows on the suggestion or row, never an empty state that looks like *no suggestions*.

---

## Open questions

1. **Headless extension host.** Worth running real extension code (a headless VS Code extension
   host) to cover extensions with no language server and no engine? Heavy; covers everything.
2. **Preview for non-file tools.** A formatter previews as a diff. What does a long press show for
   `build` or `push`: the command line, the commits to be pushed, a dry run?
3. **Chains that need values.** `commit` needs a message. When the typed text holds one
   (`commit it as tidy code surface`), who extracts it? Laya classifies; it does not extract. A
   small parse, or the agent for that step only?
4. **Where the harness lives.** The eval scripts are in `~/Coding/laya`. Move them into the repo
   when the service lands, next to the backend that calls Laya?
5. **Multilingual.** The gate and routing were tested in English only. The `multilingual`
   checkpoint exists if needed.

## Suggested order of work

1. Laya server in tmux, backend client, catalog from **package scripts and built-ins** only.
   Single-suggestion chips with play. Measures the margin rule on real use.
2. **Extension scanning** (P7 layers 1 to 3) with Prettier and ESLint as the first two, their
   runners, and per-extension settings.
3. **Chains**: gate, split, checklist, Run, stop on failure.
4. **Long-press previews.**
5. **Recommended tools on sent messages** (P8).
6. **Language-server runner** for extensions beyond the first two.
