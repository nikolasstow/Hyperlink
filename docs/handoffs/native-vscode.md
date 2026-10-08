# North star: VS Code on the phone, native

The goal is VS Code's *capabilities* on iOS, delivered **natively** (SwiftUI/UIKit
+ our forked Runestone editor), not a web app — and feeling like one cohesive
tool, not a drawer of gadgets.

## Thesis — reuse the protocols and data, not the UI

VS Code is a **protocol client** with a web UI and a Node engine host. Its
portable parts are its **protocols and data**, which we reuse wholesale:

- **LSP** (language intelligence), **DAP** (debugging) — open protocols.
- **TextMate grammars**, **VS Code theme JSON**, **snippets**,
  **language-configuration** — declarative; Shiki already consumes the grammars
  and themes.
- Extension **contributions** that are data (grammars/themes/snippets/commands/
  keybindings) are portable; the ones that are UI (webview panels) are the tail.

So: **native UI + native editor; reuse VS Code's protocols/grammars/themes/
extension-data; run the engines that can't live on a phone — language servers,
the extension host, debug adapters, ripgrep, git — remotely on the opencode box,
over their standard protocols; keep a local fast-path for latency.** Monaco → our
Runestone fork. Node engine host → opencode. Web shell → native.

## The spine (cohesion — build before piling on features)

What makes VS Code feel unified, and what we must build so features compose:

1. **One document model** — buffer + version, the single source of truth the
   editor, highlighter, structure, local + remote LSP, and diffs all share.
2. **One command system + palette** — every capability is a command (Cmd-P,
   keybindings); features invoke uniformly.
3. **One theme** — VS Code theme JSON drives the editor *and* all native chrome.
4. **One workspace model** — files, open tabs, diagnostics, git state, search —
   shared across views.

## Capability map (where each runs / status)

| Capability | Runs | Status |
|---|---|---|
| Editor core (cursors, selection, undo, find, fold, sticky, wrap, brackets) | native (Runestone fork) | sticky landing; folding/find/multi-cursor next |
| Highlighting + themes | native (Shiki + VS Code themes) | done |
| Structure (outline, breadcrumbs, folding, sticky) | local real parser (TS AST / markdown; tree-sitter later) | sticky in progress; outline/breadcrumbs are the same ranges |
| IntelliSense (complete, hover, diag, defs, refs, rename, actions, format, semantic tokens, inlay) | hybrid: local JS services + remote LSP, multiplexed | next big layer — see [[code-intelligence]] |
| Workspace (explorer, tabs, Cmd-P, cross-file search) | native UI; search = remote ripgrep | explorer/tabs done; Cmd-P + search next |
| Git (diff, gutter, stage/commit, blame, conflicts) | remote git, native diff UI | later |
| Debugging (breakpoints, step, vars, watch) | remote DAP, native UI | later |
| Terminal | remote PTY, native view | later |
| Extensions | remote host + native consumption of declarative contributions | staged; the tail |
| AI / inline suggestions | opencode agent | our edge; can ride the completion path |

Detailed LSP/structure architecture (3 layers, the hybrid multiplexer, build
decomposition): `docs/handoffs/code-intelligence.md`.

## First-class: the Effect language service

`@effect/language-service` is a TypeScript-server **plugin** (plus a diagnostics
CLI) that adds Effect-aware diagnostics, completions, refactors, and hovers. This
project *is* Effect, so it is a requirement, not a nice-to-have:

- **Remote TS LSP** must load `@effect/language-service` as a `tsserver` plugin
  (its `plugins` config), so Effect diagnostics/quick-fixes flow over LSP like
  any other.
- **Local embedded TS service** (hybrid layer 2) should load the same plugin, so
  the fast on-device path is Effect-aware too.
- Treat it as the proof that our LSP layer carries *plugins*, not just vanilla
  tsserver — the mechanism generalises to any TS-server plugin.

## Build order (each step ships; hybrid is the capstone)

1. **Editor core + structure** (native, Metro-improvable): sticky → folding,
   find/replace, multi-cursor, outline + breadcrumbs (reuse sticky ranges).
2. **Language intelligence**: remote LSP client (with the Effect plugin) → then
   the local hybrid for the hot path.
3. **The spine**: document model + command palette + settings/keybindings.
4. **Workspace depth**: Cmd-P, cross-file search, git diff/commit.
5. **Extensions (remote host + native contributions) + debugging (DAP)**.

## Honest edges

The bar is *the same capabilities, native and cohesive* — not re-rendering 100%
of VS Code's UI. Extension **webview** UIs are where native hits a wall; a
constrained web surface may be the pragmatic exception there, but the editor and
core stay native. True cross-file semantics (repo-wide rename, project
diagnostics) is exactly why the heavy LSP lives remote.
