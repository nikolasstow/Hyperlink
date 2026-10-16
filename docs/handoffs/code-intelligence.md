# Code intelligence for the native editor (agent-console-native)

The native editor (forked Runestone + Shiki) needs structure (sticky scroll,
folding) and semantics (completion, hover, diagnostics, definition). This is the
agreed architecture and build order. Shiki stays the colourer; everything here is
additive.

## The three layers

Separate by *what context a request needs*, which decides where it can run.

1. **Structure — always local, all languages.** Nesting tree + ranges: sticky
   scroll, folding, bracket matching, smart selection. A real parser, not an
   indentation heuristic. No network, no language server.
2. **Local semantics — JS/TS stack, on-device.** The embeddable JS language
   services (TypeScript, JSON, CSS, HTML, ESLint) run in a JS runtime — no
   process, no JIT (both of which iOS forbids). The app already ships a second
   JS context (`ExpoModulesWorklets`), so these run off the UI thread. Instant,
   same-file + globals; weaker cross-import (TS needs import types it may not
   have locally — the hybrid covers that seam).
3. **Remote semantics — everything heavy / all other languages.** The server
   (our API server; see Remote host) runs the real language servers (gopls, rust-analyzer, clangd,
   tsserver with the full project). Queried over RPC. Complete, higher latency.

Why not "just run the LSP locally": language servers are separate processes, and
iOS forbids spawning processes and JIT. So the *server* model can't run
on-device. JS-based services sidestep it (they're libraries, not processes);
compiled-language servers can't (WASM ports run interpreted = too slow). That's
the whole reason for the split.

## The hybrid (layers 2 + 3): local-first, remote floor

Remote is the always-on floor; local *upgrades* the hot path once warm — never a
dead window (the key requirement). A **client-side multiplexer** in the editor:

- Pipes live edits (`didChange`) to BOTH backends so neither goes stale.
- Per-document "local ready" flag, flipped when the embedded service has built
  the file's program (inferred from the first successful semantic query).
- Routes by method + readiness, remote as fallback for everything:
  - **Local when warm:** completion (same-file/globals), hover (local symbols),
    signature help, format, selection range, folding/`documentSymbol`,
    as-you-type diagnostics — the per-keystroke hot path.
  - **Remote always:** definition across files, references, rename, workspace
    symbols, auto-import completion, authoritative project diagnostics.
- **Completions** can merge: show local instantly, append remote's cross-file
  items when they land.
- **Diagnostics** are the sharp edge — two sources for one file. Show local as a
  fast preview; treat remote as source-of-truth and reconcile (guard flicker).

It degrades perfectly: remote-only is already a complete editor; local is pure
latency on the hot path, added last, so it can't block or break the baseline.

## Where the type preview goes (owner, decided earlier; written down 2026-10-15)

The **type preview lives in the glass that expands from the breadcrumbs** (the top
pill in Files, `BreadcrumbPill`). Collapsed, the pill is the breadcrumbs (path ›
scopes); expanded, the same glass grows to hold the type of what you are at, in the
dual form the docs site already uses: the compact named type
(`QueueResource<EmailJob>`), the expanded member shape, and the JSDoc as Markdown
with Shiki-coloured code. Not a separate hover popover.

## Build decomposition (how to ship it without blind native churn)

Key move: **structure is a prop into a native overlay.** The native editor can't
be fully compiled on this machine (the `expo-modules-jsi` × Xcode-26.3 bug blocks
the pod — see [[reference-no-xcode-installed]]), and native changes need an EAS
build, so minimise what's locked into the binary.

- **Native (one rebuild):** a sticky-scroll / folding overlay in the fork that,
  given `[{ header, start, end, depth }]` ranges + the scroll offset, pins the
  enclosing headers at the top (reusing each line's rendered tokens) with
  tap-to-jump; plus the scroll/line-geometry it needs. This is pure
  Runestone/UIKit (NO ExpoModulesCore), so it **compiles locally via SPM**
  (`xcodebuild -scheme Runestone`) — validate before every EAS build.
- **Structure source = JS prop, improvable over Metro (no rebuild):** the ranges
  come down as a prop. So the *algorithm* is not locked into the binary — we can
  improve it live. Start with a real parser:
  - TS/TSX/JS/JSON → the **TypeScript compiler AST** (the same engine as layer 2;
    real parse, not a heuristic).
  - Other languages → remote structure, or **tree-sitter** as a universal
    on-device parser later (its C runtime + grammars vendored into the pod — a
    bigger native add, only if we want universal on-device structure).

This keeps "real parsing, on-device" while making the risky part (the binary)
small and locally verifiable, and the improvable part (the algorithm) a free
Metro update.

## Remote host (owner, 2026-10-15)

opencode v2 has no language-server runtime (its edit tool: `TODO: Add LSP … after
LSP runtime exists`). So layer 3's servers run on **our API server** (:5199, same
Mac) instead: `typescript-language-server` over stdio, using the workspace's own
TypeScript so `@effect/language-service` loads from `tsconfig.json`; other
languages later the same way. Fed from the file hub (the text it already keeps for
followed files). If opencode gains an LSP runtime, the host can move there; the
protocol does not change.

## AI inline suggestions (Copilot-style), where they fit

Planned in `native-ide.md` §3 (ghost text; configurable model; a dedicated
`/complete` FIM endpoint, not the chat path). They share this plan's pieces:

- **Native:** ghost text after the caret (Tab accepts) needs the caret's exact
  offset, which the type preview needs too. Squiggles, the caret offset and ghost
  text go into **one** native build.
- **Server:** `/complete` lives on the API server beside the language servers.
- **Context:** the language server makes the prompt better: the types and
  signatures around the caret go with the prefix/suffix.
- **Beside IntelliSense, as in VS Code:** language-server completions are a list;
  the AI's is ghost text. Two providers, both routed by the multiplexer.

### Accepting a suggestion (owner, 2026-10-15)

A phone keyboard has no Tab. A suggestion is accepted by **tapping it**, or by a
**double space** (the second space accepts; the first is taken back). iOS may turn
two spaces into ". " (its period shortcut): that counts as a double space too.

**Model call:** opencode v2's one-shot `POST /api/experimental/generate`
(`{ prompt, model? }`, no session, no agent; ~1.3 s with Haiku 4.5). The API
server's `/complete` builds the fill-in-the-middle prompt and calls it.

### Suggestions as the best editors make them (Claude, 2026-10-15)

Researched (Copilot, Zed's Zeta, Cursor Tab): a **fill-in-the-middle** model, not a chat
model; 200-500 ms; context = current file > other open files' similar chunks > language server;
cancel in flight; type-through; one line mid-line, a block on a line of its own; next-edit
prediction is the newest step. Owner: support several backends; personally Qwen.

- **Local:** llama.cpp serving the base **Qwen2.5-Coder 7B, Q4_K_M**
  (`QuantFactory/Qwen2.5-Coder-7B-GGUF`) with the 0.5B as a draft model, on `127.0.0.1:8012`.
  **The API server manages it; nothing is started by hand** (owner, 2026-10-15). Its
  `LocalModel` service (agent-console `server/localModel/`, protocol `LocalModel`) starts it
  with the server when it is on, watches `/health` until it answers (`ready`), starts it again
  with backoff if it stops, and stops it with the server (not detached: a server killed
  outright takes it along). If another server on the machine already runs one on the port, it
  uses that one and takes over when it goes. Settings (on/off, model: 7B Q4 / 7B Q8 / 3B) are
  kept in the state folder (`local-model.json`). llama.cpp itself is installed with Homebrew
  from the app. `/complete` uses it when it is `ready` (no model chosen) or when chosen.
- **App:** Server → Services → **Local model**: on/off switch, state light (with download
  progress or why it stopped), model choice, Install llama.cpp / Restart. Fetched at app open
  and on return to the foreground; polled while the page is open. Endpoints: `GET /local-model`,
  `PUT /local-model/settings`, `POST /local-model/install`, `POST /local-model/restart`.
- **Measured on the M4 (24 GB):** 7B Q8 13 tok/s (1.6 s a line), right; 7B Q4 21 tok/s (1.0 s),
  right; 3B 0.1 s but wrong (`raceAll` for `all`). First call in a file ~4.7 s (reads it); after
  that a keystroke costs only the new text (prompt cache), as long as the extra context is stable.
- **Next:** stream the answer (the first words show at once), then next-edit prediction.

## Agents see what the editor shows (owner, 2026-10-16)

> "The Lsp data, errors and stuff, should be part of the context available to Dubz and any
> applet in it including to sessions. […] the agent should know what you know."

- **One source.** The API server's language host (`server/language/host.ts`) is the only
  source of problems. The editor's squiggles, agents and Dubz all read it. No agent runs its
  own tsc or eslint to find problems; a second check could disagree with the editor.
- **Settled check.** `LanguageHost.problems(file)`: the hub catches up with the disk (an
  agent's write may not have reached the watcher), the server gets that version, a
  `semanticDiagnosticsSync` request waits for the check, then the problems are taken once the
  server publishes nothing new for 600 ms (10 s at most). They are the editor's problems for
  that version, in lines and columns from 1.
- **Endpoints** (`Language.problemsGroup`): `POST /problems {path}` (one file, settled) and
  `GET /problems/open` (every file open in a language server). Text form for agents:
  `Language.problemsText` (one place).
- **opencode plugin** (`packages/agent-console-opencode`, opencode v2): after `edit`, `write`
  and `patch`, the problems of each changed file go into the tool's result; a `diagnostics`
  tool gives one file's problems or every open file's. When the API server can't answer, the
  agent is told so (never "no problems"). Configured in opencode's `plugins` with `apiUrl`
  and `tokenFile` (the API server's admin token). Types: `@opencode/plugin` 2.0.29, its
  effect pinned to ours (pnpm overrides).
- **ESLint** (`server/language/eslintServer.ts`): the server VS Code runs (Microsoft's
  `vscode-eslint` 3.0.34, MIT), taken from its Open VSX package, pinned and hash-checked,
  fetched once into the state folder (`language-servers/`). One per repo beside TypeScript's;
  it lints with the repo's own ESLint and config (same results as the `eslint` command). Its
  problems are pulled (`textDocument/diagnostic`) after each change and joined to
  TypeScript's, for the editor and for agents. A repo without ESLint gets TypeScript's only.
- **Next:** a `Diagnostics { file, problems }` entry in DubzContext (data only; the Dubz UI
  is someone else's); the problems of files in a session's context sent with its messages.

## Build order (each step ships value; hybrid is the capstone)

1. **Sticky scroll + folding + breadcrumbs.** Native overlay + structure from
   the TS AST / Markdown headings. **Done.**
2. **Remote language servers on the API server** (above), streamed to the app
   over the live-file connection:
   - **a. Errors:** squiggles in the editor (native), the message on a tap.
   - **b. Type preview** in the glass that expands from the breadcrumbs (above):
     the type at the caret (else the innermost scope), dual form.
3. **AI inline suggestions:** `/complete` (FIM, configurable model, language
   server context) + ghost text. Its native part ships with 2's.
4. **Local embedded TS service + multiplexer** (the hybrid): as-you-type errors,
   type preview and completions instant on the phone; remote stays the
   authority. Once we can measure where latency bites.
5. **(optional) tree-sitter** for universal on-device structure.

**One native build** for 2–3: diagnostics ranges (squiggles + gutter marks), the
caret's offset (event), ghost text (inline suggestion, accept/dismiss).

## Status

- [x] Architecture agreed (this doc).
- [x] (1) Native sticky-scroll/folding overlay — structure as a ranges prop.
- [x] (1) JS structure provider from the TS AST (TS/TSX/JS/JSON) + Markdown.
- [x] (2) Language servers on the API server (`server/language/`, `/language` RPC, `agent-console-protocol` Language); one `typescript-language-server` per repo, Effect plugin live.
- [x] (2a) Errors: wavy lines + glass popover (native `Diagnostics.swift`, apiVersion 14; built on EAS), carried through unsaved edits.
- [x] (2b) Type preview in the breadcrumb glass: caret (apiVersion 14) else innermost scope; prefetched. Compact type + docs; the expanded member shape (TS 5.9 `verbosityLevel`) is next.
- [x] (3) AI inline suggestions: `/complete` (opencode generate) + ghost text (native `InlineSuggestion.swift`, apiVersion 15); tap or double space accepts; Settings → Files (on/off, model; default Claude Haiku 4.5). The prompt carries the language server's context at the caret (the call being typed in, the names valid there; `contextAt`, 600 ms at most).
- [x] Agents get the editor's problems: settled `problems` endpoints + opencode plugin (edit results, `diagnostics` tool).
- [x] ESLint's language server in the host (editor and agents).
- [ ] DubzContext `Diagnostics` entry; problems sent with messages.
- [ ] (4) Embedded TS language service (worklet runtime) + multiplexer.
- [ ] (5) tree-sitter universal structure (if needed).
