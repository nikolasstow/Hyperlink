# Agent report: code surface documents

**Branch:** `feat/code-surface-documents`, on top of `fix/code-surface-full-editor`
**Base:** `app/double-agent/ios` (`777bc724`)
**State:** Code complete, gate green, verified in a browser, nothing run on a device.

The surface holds one Monaco model per file instead of rewriting a single one,
so switching back to a file returns it with its scroll position, its cursor and
its undo history. This is step 1 of making file switching instant; step 2, a
native host that survives navigation, needs a rebuild and is not here.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## What was wrong

The surface kept one model and called `setValue` on it for every file. A model
carries its own undo stack, its markers and its decorations, so rewriting it
threw all of that away each time. Reopening a file put you at the top of it with
no history, no matter how recently you had been editing.

## What it does now

`setContent` is replaced by four messages: `openDocument`, `showDocument`,
`closeDocument` and `closeAllExcept`. The surface keeps a model per path, keyed
by a `file:` URI so a later phase can hand it to a language server unchanged.

Scroll position and cursor are not part of a model. They come from
`editor.saveViewState()`, so the surface saves the outgoing file's state before
switching and restores the incoming one's. That is what makes a switch feel like
returning rather than reopening.

The host tracks which paths the surface is holding. A file it still has costs
one short message; one it has let go of costs the whole text again. A `ready`
means the surface has forgotten everything, so the host clears its own idea of
what is held at the same moment.

## The budget

Measured rather than guessed, on files of three sizes:

| file | held, never displayed | after being displayed |
|------|----------------------|-----------------------|
| 500 lines, 53 KB | 0.03 MB | 0.67 MB |
| 2,000 lines, 213 KB | 0.02 MB | 0.98 MB |
| 10,000 lines, 1 MB | 0.06 MB | 3.83 MB |

Monaco with no document at all is 15.2 MB.

A model nobody has looked at costs about its own text. The cost arrives on
display, when tokenization state is built, and it scales with the file rather
than being flat per file. So the budget counts bytes, not files:
**4 MB of text, with a cap of 12 documents** beside it to stop churn through
many tiny files building structures that never cross the byte limit.

`evictionsFor` is pure and tested. Two rules it holds to: the visible file is
never evicted whatever the budget says, and eviction stops as soon as both
limits are met rather than emptying the list.

**It evicts by recency, not by size.** Four large files arriving can push out
several small old ones that together free almost nothing. That is the usual
behaviour of an LRU and it is what a reader expects, so it is left as is;
weighting by size would reclaim faster and surprise more.

## Verified in a browser

Chromium, driving the built asset with the same messages the app sends.

| Checked | Result |
|---------|--------|
| Two files open, second shown | Correct file displayed |
| Switch away and back | Content correct both ways |
| Scroll position across a switch | Line 281 before, line 281 after |
| Undo history across a switch | An edit made before the switch undoes after it |
| Eviction past the byte budget | Oldest three let go, each reported to the host |
| The visible file under budget pressure | Kept |
| `closeAllExcept`, then showing a closed file | Refused, nothing rendered |
| Page and surface errors | None |

## Verified in the repo

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 pre-existing warning
npx vitest run                                                    1220 passed, 8 skipped
```

`codeSurfaceProtocol.test.ts` carries 114 tests, 11 of them new, over the
eviction policy and the document messages.

## Sharp edges

**This does not make the first open faster.** Every `FileViewerScreen` still
builds its own WebView and re-parses 5.4 MB, about 700 ms, because React Native
cannot move a native view between parents. What this buys is switching between
files the surface already holds. The first open needs the native host in step 2.

**Nothing has run on a device.** The memory figures are Chromium's; what
WKWebView tolerates before iOS kills its content process is the number that
would move the 4 MB budget, and only a device gives it.

**Nothing sends `closeAllExcept` yet.** The message and its handling are here
and tested, but wiring it to an iOS memory warning belongs with the native host,
where the warning is actually observed.

## Next

1. Step 2: `modules/code-surface/`, a Swift `ExpoView` over a pool of warmed
   `WKWebView`s, so the surface survives navigation and the first open is free.
2. Wire memory pressure to `closeAllExcept` once that lands.
3. Revisit the 4 MB budget with a device measurement.
