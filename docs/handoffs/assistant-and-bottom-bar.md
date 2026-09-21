# Assistant (Dubz) & the bottom bar

**Status:** Assistant button + visibility settings + compositional `BottomBar` shell SHIPPED (chat/Home composer). The assistant's own behavior is PLANNED. Owner-driven; app-wide agent to be spec'd by a separate agent later.
**Package:** `packages/agent-console-native`. Device-only UI (no simulator here) — verify on device.
**Related:** `agent-console-native-composer.md` (composer invariants — load-bearing), `skills-management.md`, `rules-app-integration.md`.

## The assistant: "Dubz"

The app is "Double Agent", so the app-wide assistant is **Dubz**. It's the entry point to an always-accessible, context-aware agent (big plans; a later agent nails the spec). For now only the **button UI** exists — the handler is a stub.

- **Look:** a glass circle tinted with the theme **secondary** accent + a **white `sparkles` glyph** — the secondary-coloured counterpart to the primary-coloured send button (fill is the accent, glyph is white; the send button's own recipe). `AgentButton.tsx` (`AGENT_NAME`, `AGENT_BUTTON_SIZE`).
- **Single accessory.** There is exactly one bottom-bar accessory (the assistant), not a general accessory system.

## Bottom bar behavior (shipped on the chat/Home composer)

Two kinds of bottom bar — **chat input** and **search** — are meant to converge into one **compositional shell** (see below). The shipped change is on the chat composer (`Composer.tsx`):

- **Collapsed:** `( (+) placeholder ) (❇️)` — the **send button is hidden** (slides to width 0 / opacity 0) and the **assistant** rides the pill's right edge, outside the pill, vertically centred.
- **Expanded** (focused/typing): send returns inside the pill; the assistant slides away.
- Both are gated by **width/opacity + the existing expand/collapse `LayoutAnimation`** — nothing unmounts, preserving the composer's glass/`Host` first-mount invariants (see the composer handoff). The assistant's crop was fixed by clipping (`overflow: hidden`) **only** during collapse, never while shown.

## Visibility settings

`agentButtonSettings.ts` — a live module store (`useSyncExternalStore`, AsyncStorage-backed, same shape as `sessionPermissions`):

- **Master switch** (`enabled`) — off hides the button everywhere.
- **Per-surface** switches: `home`, `repo`, `session`, `editor` (file/doc/rule editors). Applied only while the master is on.

`AgentButtonSettingsScreen.tsx` is the full page (master toggle on top, per-surface list below, dimmed when master is off), reached from **Settings → Dubz** (a menu item that opens the page, next to Appearance/Extensions). The composer reads `useAgentButtonVisible(surface)` and renders the button only when enabled for its surface (`agentSurface` prop: Home passes `"home"`, chat passes `"session"`).

`repo` and `editor` are wired in the settings/config now; those surfaces render the button as they're built out (the app-wide agent work).

## The compositional `BottomBar` shell (SHIPPED)

Per owner direction — **a shell that takes slotted components, not one massive component with variant params.** `BottomBar.tsx` owns the hard parts once (glass field + squircle clip, the collapse *layout*, the assistant accessory + its visibility, trailing gating) and takes the variable parts as slots: `input`, `leading` (+), `expandedCenter` (model picker), `collapsedCenter` (mirror), `trailing` (send), `topSection`. `Composer.tsx` is now the chat variant: it owns the intricate state (focus/text/animation/model/send) and passes those slots, driving the shell with a single `expanded` flag.

The shell is **presentational** (no state) — deliberately, so the fragile focus→animate→collapse timing stays in one place (the variant) and the invariants hold by construction: nothing unmounts across the collapse cycle, the clip is on the plain `fieldClip` View, and the variant still triggers the `LayoutAnimation` while the layout it animates lives in the shell. A pure-context version (no `expanded` prop) is a possible later refinement; the slot split is the win the owner asked for.

The eventual/earlier sketch of the slot API:

```
<BottomBar>                    // owns glass, expand state, animation, assistant accessory
  <BottomBar.Leading>          // + (chat) or 🔎 (search) — always visible
  <BottomBar.Field>            // input / search field; reads expanded + focus from shell context
  <BottomBar.Trailing>         // shown only EXPANDED — Send (chat)
  // assistant accessory is built into the shell (single, app-wide), shown only COLLAPSED
</BottomBar>
```

- **Context, not params** for the field↔shell coupling (`expanded`, `inputRef`, focus handlers) — that coupling is what makes the collapse work today, so it must stay intact.
- **Sequencing:** the shipped change was made on the current `Composer` first (a confirmed-good baseline the owner can test on device), because rewriting the fragile glass field into slots **and** changing behavior at once, blind, is how the documented glass/desync bugs return. The shell refactor is the next step against that baseline, chat-first, then the search pill moves onto it.

## Open / later

- Wire the assistant's actual behavior (the app-wide, context-aware agent) — separate spec, later agent.
- Move the **search** bottom bar (`BottomSearchPill`) onto `BottomBar` too — its scroll-hide behavior differs, so it was left separate for now (the shell was built chat-first).
- Optional refinement: a pure-context `BottomBar` (drop the `expanded` prop) if the slot split proves it wants it.
- Render the assistant on the `repo` and `editor` surfaces once those exist.
