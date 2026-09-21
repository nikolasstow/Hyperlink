# Agent report: theme editor issues

**Branch:** `fix/theme-editor-issues`
**Base:** `app/double-agent/ios` (`4feb7803`)
**Covers:** the five items still live from
[the issue inventory](./2026-09-20-prototype-issue-inventory.md) after the owner's own
theme editor work landed.
**State:** Code complete, gate green, nothing run on a device.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## Three ways a saved theme could be lost

All three in `createdThemes.ts`, and all three the reason that module no longer follows the
best-effort AsyncStorage pattern `sessionCache.ts` uses. A cache that loses an entry refetches
it. A theme someone spent an evening on is gone.

**A theme that would not parse was deleted by the next save.** The read dropped a row it could
not parse and the write persisted whatever the read returned, so one unreadable row vanished
the next time any other theme was saved. Rows this build cannot parse are now carried through
a write untouched.

**Two saves in flight lost one of them.** Every operation is a read, a change and a write
back, so the later read overwrote the earlier save. Writes run one at a time now, through a
promise chain that a rejected operation does not stall.

**A failed write reported success.** `setItem` was called `.catch(() => undefined)` and the
Save button closed the screen either way. The write raises now, and the editor says so instead
of implying the theme was stored.

## The picker was rewriting every colour it touched

`@expo/ui`'s `ColorPicker` formats with `#%02X%02X%02X%02X` whenever `supportsOpacity` is on,
which both picker screens pass because plenty of theme keys are deliberately translucent. So
it answers with eight uppercase digits whatever notation it was handed, and a key written
`#1e1e1e` came back `#1E1E1EFF` on the first edit. VS Code reads the two as the same colour,
so the rewrite bought nothing and cost a diff on every key anyone touched: import a theme,
change one colour, and the document that came back out differed on keys nobody edited.

`normalizePickedColor` reads the reported value back into the key's own notation. A fully
opaque colour is written in six digits unless the key already carried an alpha channel, and
the case follows whatever the key was written in. `isPickedColorChange` is the same comparison
used as a guard, so a picker reporting the value already stored records nothing.

Worth knowing for anything else that reads a colour back from that control: the mount-time
write this was once suspected of does not happen. `ios/ColorPickerView.swift` records the hex
it was handed in `.onAppear` and dispatches only on a difference.

## Search reaches the keys a theme has not set

The catalog holds several hundred colour keys and a theme sets on the order of a hundred of
them. Before this, a key the theme had not set was reachable only by scrolling to its group.

Search now carries a second section, **Add keys**, below the real results. Its rows are
dimmed, show no swatch and read `Not set`; tapping one opens that key with an Add row, so the
path from typing a name to giving it a value is two taps.

They are a separate section rather than mixed into the results, because the two answer
different questions and mixing them would bury what the theme holds under everything it could
hold. The section is capped at twenty, since a broad query would otherwise push the token
scopes off the screen.

**A read-only theme does not show it.** An installed theme opened through `viewFile` has
nothing to add, where the section would be noise.

## Files

| Path | Change |
|------|--------|
| `src/createdThemes.ts` | Unreadable rows preserved, writes serialised, failures raised |
| `src/ThemeEditorScreen.tsx` | Save reports a failed write; the Add keys section |
| `src/vscodeTheme.ts` | `normalizePickedColor`, `isPickedColorChange`, `searchUnsetKeys` |
| `src/ThemeColorGroupScreen.tsx` | Colour notation; offers a focused key the theme has not set |
| `src/ThemeTokenRuleScreen.tsx` | Colour notation |
| `src/vscodeTheme.test.ts` | 17 tests over the notation round trip and the unset search |

## Left alone, with a reason

**Token rules are still addressed by array index.** The inventory listed the index shift as a
latent hazard. Checked against what the editor can actually do: nothing reorders
`tokenColors`, the list screen only appends, `applyImport` appends, and deletion happens on
the rule screen which pops straight after. No sequence reaches the failure. A stable id would
have to live either in the document model, which is the VS Code format and not ours to extend,
or in a second array kept in step with the first. Recorded as a constraint instead: anything
that reorders or inserts rules has to bring ids with it.

## Verified

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 pre-existing warning
npx vitest run                                                    1185 passed, 8 skipped
```

## Sharp edges

**Nothing has run on a device.** The Add keys section and both picker screens want a look on
hardware, and the colour notation is best checked by importing a theme, changing one key and
reading the saved document back.

**Created themes are still device-local.** Whether a few hundred keys belong in the server's
last-write-wins `config` document is still the open call.
