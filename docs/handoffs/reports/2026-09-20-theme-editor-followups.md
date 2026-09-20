# Agent report: theme editor follow-ups

**Branch:** `fix/theme-editor-followups`
**Base:** `app/double-agent/ios` (`6d152140`)
**Covers:** sections B3, B4, B5, B8 and a corrected B2 of
[the issue inventory](./2026-09-20-prototype-issue-inventory.md).
**State:** Code complete, gate green, nothing run on a device.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## What the picker actually does

The inventory said an unset colour might be written the moment someone opened the picker on
it. Reading `@expo/ui@57.0.13`'s `ios/ColorPickerView.swift` settles it, and the answer is
different from the guess.

The Swift view already guards a mount-time write: `.onAppear` records the hex of the colour it
was handed, and the `.onChange(of: selection)` that dispatches back to JavaScript fires only
when the new hex differs from that record. Nothing is written by opening a picker.

What it does do is format with `#%02X%02X%02X%02X` whenever `supportsOpacity` is on, which
both screens pass because plenty of theme keys are deliberately translucent. So the picker
answers in eight uppercase digits whatever notation it was given. Taken at face value, the
first edit to a key written `#1e1e1e` stores it as `#1E1E1EFF`. VS Code reads the two as the
same colour, so the rewrite buys nothing, and it lands on every key anyone touches: import a
theme, change one colour, and the file that comes back out differs from the one that went in
on keys nobody edited.

`normalizePickedColor` reads the reported value back into the notation the key was already
using. A fully opaque colour is written in six digits unless the key already carried an alpha
channel, and the case follows the key's own. `isPickedColorChange` is the same comparison used
as a guard, so a picker that reports a value equal to the stored one records nothing.

## Every key in a group is now a real key

`ThemeColorGroupScreen` built its Add list by taking each of the group's prefixes and appending
`.background`. That invented keys VS Code does not define and left out nearly all of the ones
it does.

`pnpm hyp theme-keys emit` (`dev/cli/themeKeys.ts`) reads the 65 themes bundled with `shiki`,
the library the app already renders code with, and writes
`packages/agent-console-native/src/vscodeColorKeys.gen.ts`: 860 keys, ordered by how many of
those themes set each one.

VS Code publishes no machine-readable list of its colour keys, so this is a derived registry
rather than the authoritative one. It leaves out any key that no bundled theme happens to set,
and it lets in keys that were renamed or deprecated after a bundled theme was written. The
ordering is what makes that acceptable: a key 60 of 65 themes set is worth offering, and one a
single theme set sits far enough down the list that search is how it gets reached.

Group sizes run from 24 keys (`terminal`) to 287 (`other`), so a group offers the 50 most
widely used and says how many it left out. The 50 are sorted by name for reading; the cut is
by commonality.

| Group | Keys |
|-------|-----:|
| Editor | 111 |
| Side bar and activity bar | 24 |
| Tabs and editor groups | 40 |
| Status bar and title bar | 39 |
| Terminal | 28 |
| Buttons, inputs and lists | 92 |
| Git and diff | 48 |
| Panels, notifications and debug | 127 |
| Widgets and overlays | 64 |
| Everything else | 287 |

The cut is only defensible because search now reaches what it hides. `searchTheme` matches
unset keys after the set ones, and a search result for a key the theme does not set opens the
group screen with an Add row for it. Before this, a key nobody had set was reachable from
nowhere.

The screen renders its rows rather than virtualising them, and that is deliberate: the set
rows carry a native `ColorPicker` each, and a recycling list is the one thing `Host` is known
to handle badly.

## Two ways a saved theme could be lost

**A theme that would not parse was deleted by the next save.** `toCreatedTheme` dropped an
unreadable row on read, and `write` persisted whatever the read returned, so one bad row was
gone the next time any other theme was saved. Storage now carries those rows through a write
untouched.

**Two saves in flight lost one of them.** Every operation is a read, a change and a write
back, so overlapping saves ended with the later read overwriting the earlier save. Writes run
one at a time now, and a rejected operation does not stall the ones behind it.

**A failed write looked like a success.** `AsyncStorage.setItem` was called with
`.catch(() => undefined)` and the Save button closed the screen either way. The write now
raises and the screen says so.

## Duplicating an installed theme

Touch and hold an installed theme in Appearance to start an editable copy of it, named
`<theme> copy`. The `ThemeEditor` route takes an optional source file, so the same screen
prefills from a named theme rather than only from the one currently applied. Editing a stock
theme was create-then-import before, which is four screens for what is now one gesture.

## Left alone, with reasons

**Token rules are addressed by array index,** and the inventory listed that as a latent
hazard. It is not reachable: nothing in the editor reorders `tokenColors`, the list screen only
appends, and deletion happens on the rule screen which pops immediately after. Adding stable
ids would mean either putting them in the document model, which is the VS Code format, or
keeping a parallel array in the draft, which is the fragile half of the same idea. Neither is
worth building for a failure nothing can currently produce.

**Created themes still do not sync.** That needs a decision about whether a few hundred keys
belong in the server's last-write-wins `config` document.

**The `Host` recycling hazard is still unverified,** because nothing here has run on a device.
It is the first thing to test.

## Verified

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx tsc --noEmit -p tsconfig.json                                 exit 0 for dev/cli
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 pre-existing warning
npx vitest run                                                    1184 passed, 8 skipped
```

`vscodeTheme.test.ts` carries 78 tests, up from 55: the colour notation round trip, the
registry, the capped unset list, and search reaching keys the theme has not set.

## Next

1. Build to a device and walk the flow, watching a long colour group scroll for dead pickers.
2. Decide whether created themes sync through the server config document.
3. Re-run `pnpm hyp theme-keys emit` whenever `shiki` is upgraded; the generated module says
   which version it came from through the theme count.
