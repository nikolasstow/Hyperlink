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
- [x] (2a) Errors: wavy lines + glass popover (native `Diagnostics.swift`, apiVersion 14), carried through unsaved edits. Awaiting the device build.
- [x] (2b) Type preview in the breadcrumb glass: caret (apiVersion 14) else innermost scope; prefetched. Compact type + docs; the expanded member shape (TS 5.9 `verbosityLevel`) is next.
- [ ] (3) AI inline suggestions: `/complete` + ghost text.
- [ ] (4) Embedded TS language service (worklet runtime) + multiplexer.
- [ ] (5) tree-sitter universal structure (if needed).
