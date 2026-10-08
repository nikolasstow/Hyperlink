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
3. **Remote semantics — everything heavy / all other languages.** opencode on
   the server runs the real language servers (gopls, rust-analyzer, clangd,
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

## Build order (each step ships value; hybrid is the capstone)

1. **Sticky scroll + folding.** Native overlay (consumes ranges + scroll) +
   JS structure from the TS AST. Delivers the requested feature; lays the
   structure layer. Native piece SPM-compiled locally, then one EAS build.
2. **Remote LSP client → opencode.** Full semantics, all languages, single
   source. Real IntelliSense end-to-end.
3. **Local embedded TS service + multiplexer/handoff.** The hybrid upgrade, on
   top of a working remote, once we can measure where latency bites.
4. **(optional) tree-sitter** for universal on-device structure, if the TS-AST +
   remote split leaves gaps.

## Status

- [x] Architecture agreed (this doc).
- [ ] (1) Native sticky-scroll/folding overlay — structure as a ranges prop.
- [ ] (1) JS structure provider from the TS AST (TS/TSX/JS/JSON).
- [ ] (2) Remote LSP client over opencode RPC.
- [ ] (3) Embedded TS language service (worklet runtime) + multiplexer.
- [ ] (4) tree-sitter universal structure (if needed).
