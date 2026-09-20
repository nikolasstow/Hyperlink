# Ways an agent shows code in chat (catalog)

Design catalog for how code appears in the agent-console chat, so each form is
handled deliberately. All share ONE highlighting source of truth — Shiki with the
active VS Code theme's grammars + tokenColors — so colors are consistent
everywhere. Status: only plain monospace today; Shiki `CodeBlock` shipped
(Appearance demo), chat wiring pending.

1. **Fenced code block** (```lang …```) — multi-line, syntax-highlighted via the
   Shiki `CodeBlock` (horizontal scroll, no wrap, theme bg/fg).
2. **Inline code** (`x`) — monospace span in prose.
3. **Diffs / patches** — unified diff or before/after with added/removed line
   backgrounds AND syntax highlighting; from edit tools.
4. **Tool-call code** — a write/edit tool call rendering its content (edits as a
   diff) in the tool bubble.
5. **File-reference chips** — `path:line` mentions as tappable snippet cards that
   open the file viewer at that range.
6. **Terminal command + output** — commands + stdout/stderr, often ANSI-colored →
   monospace with ANSI mapped to styles.
7. **Streaming code** — token-by-token; plain monospace while streaming, then
   highlighted when the block closes (on-device, so re-highlight on completion).
8. **HTML-embedded code** — messages rendered as HTML with `<pre><code>`.
9. **Rich fenced languages** — ```mermaid (diagram), math, JSON-as-tree — rendered
   specially, not as text.
10. **Whole-file / attachment** — opens in the viewer rather than inline.
11. **Collapsible long blocks** — folded with an expand affordance.
12. **Block affordances** — copy, open-in-editor, apply-patch, run.

## Fonts follow-up

Code-font selector ships with the guaranteed iOS monospaces (Menlo, Courier New,
Courier), stored as `Theme.codeFont`. NEXT: bundled coding fonts (JetBrains Mono,
Fira Code, …) and custom file/URL font uploads — both need `expo-font` (native →
a build) and a server-side font store (mirror the extension store), so fonts sync
across devices like themes.
