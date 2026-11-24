# A2UI for DoubleAgent — finding + adoption plan

**Date:** 2026-11-24. **Status:** exploration (no code yet). **Author:** Claude (at owner's "look into A2UI, do your thing").

## TL;DR
A2UI is Google's open (Apache-2.0) standard for **generative UI**: an agent streams a declarative UI blueprint as JSON; the **host renders it with its own native components** ("brand sovereignty"); it's bidirectional (user actions stream back on a `surfaceId`, the agent re-emits). Google ships a **native SwiftUI renderer**. v1.0 stable mid-2026. Stack-mates: A2A (agent↔agent), MCP (tools), AG-UI (agent↔UI transport), MCP Apps (host containers — Claude + Gemini already render A2UI inside them).

**The finding:** DA already built a *private, closed* version of A2UI — the **plugin page-block system**. Adopting A2UI is therefore **evolving a boundary we already proved**, not greenfield. Chat stays a first-class primitive (owner's correction 2026-11-24: chat isn't wrong, just not the only one); A2UI adds rich native surfaces alongside it.

## What DA already has (the private A2UI)
Wire contract in `src/pagesClient.ts` (mirrors `packages/agent-console/src/server/extensionHost/protocol.ts`), rendered by `src/PluginPageScreen.tsx`:
- A plugin declares `pages` (`src/pluginsClient.ts`: id/title/icon/requirement). A page = `PageSections { title, blocks[], menu[forms], add[forms] }`.
- `PageBlock` = tagged union: **Facts** (rows + links + opens), **Card** (rows + actions + opens), **Actions**, **Link**, **Pinned** (collection + suggestions). `SectionRow { label, value, mono, stacked }`.
- `PageAction/viewAction { command, title, icon, inline, destructive }` — a button that invokes a plugin command server-side (`invokeSections`/`invokeCollection`).
- `FormSpec { command, submitTitle, fields[] }`, `FormField { kind: text|code|choice|group, value, options }` — forms that submit commands (`FormSheet`).
- The server/plugin DESCRIBES the page as data; the app DRAWS it natively with the glass components (`CardGlass`, rows, buttons, `FormSheet`). Fetch + pull-to-refresh.

This is A2UI's exact shape (describe → native render → action back), minus: it's a **closed 5-block vocabulary**, **fetch/refresh** (not streamed/live), **no real layout** (fixed block stack, no Row/Column nesting), **no bidirectional live state sync**, **no cross-plugin composition in one view**, and **DA-only** (no interop with external A2UI agents).

## PageBlock ↔ A2UI mapping
| DA today | A2UI |
|---|---|
| `PageSections.blocks[]` (fixed stack) | a `Surface` tree of `Column`/`Row`/`Card`/`List` (real layout, nesting) |
| `Facts`/`Card` rows | `Card` + `Row`/`Text` bound via JSON-Pointer `@path` |
| `viewAction {command}` | `action` message `{name, surfaceId, context}` back to the agent |
| `FormField text/choice` | `TextField` / `ChoicePicker` with two-way input binding |
| fetch `/pages` + refresh | `createSurface`/`updateComponents`/`updateDataModel` streamed; live |
| one plugin per page | cross-app composition: multiple catalogs in one surface |
| closed block types | DA registers a **custom catalog** (its glass components) + the base catalog |

## What A2UI adds (the payoff)
1. **Live, bidirectional surfaces** — streamed `updateDataModel` on a `surfaceId` instead of fetch+refresh. Dubz can answer with a surface that updates in place as the agent works.
2. **Real layout + a richer catalog** — Row/Column/List/Tabs/Modal/Slider/DateTimeInput/Chart, nested, vs the fixed block stack. DA's rich surfaces (Shiki code block, the resizable glass window) become **custom catalog components**.
3. **Cross-plugin composition** — several plugins' components in one view (today: one plugin per page).
4. **Interop** — A2UI-emitting agents (Gemini, Claude via MCP Apps) could drive DA surfaces; DA plugins could render in other A2UI hosts. opencode already speaks MCP → a path via MCP Apps.
5. **Brand sovereignty is already how DA thinks** — "agents emit only your registered components, never raw code." DA's glass catalog = the registered components. Safe + on-brand by construction.

## The gap: the emit side
opencode speaks chat/tool/MCP, not A2UI. Options to emit A2UI: (a) a DA-side adapter that turns plugin page descriptions into A2UI surfaces (trivial — the data's already declarative); (b) opencode tool-calls → A2UI blueprints; (c) ride MCP Apps (opencode uses MCP). **Rendering is where DA is strong; emitting is the work** — but (a) is nearly free because the plugin pages are already declarative.

## Recommended pilot (low-risk, JS-only, no device build)
Write a thin **A2UI → glass renderer** in RN that maps A2UI's core catalog (Text/Card/List/Row/Column/Button/TextField/ChoicePicker) onto the **existing native glass components** (`CardGlass`, `SectionRow`, buttons, `FormSheet`) — the same ones `PluginPageScreen` already uses. Feed it a hand-written A2UI surface (or auto-convert one real plugin page, e.g. the npm/packages page, via adapter (a)). Because it reuses components already in the binary, it's **JS-only → hot-reloads over Metro, no EAS build**. It coexists with the current `PageBlock` system (both render side-by-side).

Question answered by the pilot: does A2UI → DA's native glass match the current look, and is the catalog expressive enough? If yes, migrate the plugin page system to A2UI incrementally (adapter (a) first, then native streamed surfaces), and open the door to external A2UI agents.

## Refs
- developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/
- github.com/a2ui-project/a2ui (spec v1_0; `specification/v1_0/docs/a2ui_protocol.md`)
- Google ships an open-source SwiftUI renderer (study for the native path).
- CopilotKit A2UI playground.
- DA code read: `src/pagesClient.ts`, `src/PluginPageScreen.tsx`, `src/pluginsClient.ts`; doc `docs/handoffs/double-agent-repo-screen-and-plugin-system.md §4, §23.1`.
