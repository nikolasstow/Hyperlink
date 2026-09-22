# Agent report: code surface native host

**Branch:** `feat/code-surface-native-host`, on `feat/code-surface-documents` and
`fix/code-surface-full-editor`
**Base:** `app/double-agent/ios` (`777bc724`)
**State:** Code complete. TypeScript gate green. **The Swift has never been compiled**, and
this needs an EAS build to do anything at all.

The code surface stops being owned by a screen. A pool of `WKWebView`s is built before anyone
opens a file and outlives every screen that shows one, so opening a file costs nothing and a
document can be put in the surface before it is asked for.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## Why this needs native at all

React Native gives a native view no way to move between parents. A `WKWebView` owned by
`FileViewerScreen` dies with that screen, so the next file re-parses five and a half megabytes
of Monaco and Shiki: about 700 ms, every time, measured three opens running with no
improvement.

In UIKit the same web view is an ordinary `UIView` and `addSubview` moves it without touching
its content process. That is the whole of it.

## What is here

| Path | Role |
|------|------|
| `modules/code-surface/ios/SurfacePool.swift` | The pool, and where a surface waits between screens |
| `modules/code-surface/ios/CodeSurfaceView.swift` | An `ExpoView` that borrows one and gives it back |
| `modules/code-surface/ios/CodeSurfaceModule.swift` | `warm`, the view, its prop, its event, its `send` |
| `modules/code-surface/index.ts` | The typed surface, and whether this build has it |
| `src/codeSurfaceAsset.ts` | The page's file URL, resolved once for both callers |

Changed: `src/CodeSurface.tsx` routes through the native host when the build has one,
`src/FileExplorerScreen.tsx` warms the pool, `src/FileViewerScreen.tsx` mounts the surface
before the read returns.

**A parked surface keeps a real size, off screen.** WebKit stops rendering a view that is
hidden or zero-sized, and a suspended content process is exactly the warmth the pool exists to
hold. So a waiting web view sits in a normally-sized container at `-10000, -10000` rather than
being hidden or detached.

**The page is untouched.** A raw `WKWebView` has no `window.ReactNativeWebView`, so the pool
installs a user script at document start that forwards to a `WKScriptMessageHandler`. The same
built asset therefore runs under both hosts, which is what lets this land before the build that
enables it.

**The message handler moves with the tenant.** A pooled web view carries the handler its last
view installed, and `add` throws on a duplicate name, so the view removes any existing handler
before registering itself.

**The controller is held beside the web view, not read back from it.**
`WKWebView.configuration` is `@NSCopying`, so reading it hands you a copy: a handler registered
on `webView.configuration.userContentController` goes onto that copy and never fires. `Surface`
pairs each web view with the controller it was built with, which is the only one that works.

**The handler is a weak proxy, not the view.** `WKUserContentController` retains its message
handlers, so registering the view itself would close a cycle the view could never escape: the
view holds the web view, which holds the controller, which would hold the view. `deinit` would
never run and the surface would never return to the pool.

## It does nothing until you build, and breaks nothing before that

`requireNativeModule` and `requireNativeView` are read inside a `try`, the way `HtmlToolBlock`
already treats `expo-web-browser`. A build without the module gets `undefined`, and
`CodeSurface` renders the `react-native-webview` host exactly as it does today. `warmCodeSurfaces`
is a no-op there, so no caller has to ask first.

## The one win that does not need the build

`FileViewerScreen` rendered the surface only once `/fs/read` had returned, so the 700 ms parse
started **after** the read rather than during it. The surface now mounts as soon as the screen
appears and opens nothing until there is something to open, so the two overlap. `text` became
optional on `CodeSurface` to express that.

## Warming

Two surfaces, built when the file tree opens. One is being looked at and the second is what a
second file opens into. Doing it at launch would charge everyone who never opens a file; doing
it on the tap is the wait this exists to remove. The module caps the request at four whatever
the caller asks for, because each surface carries Monaco's own 15 MB baseline.

## Verified

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 pre-existing warning
npx vitest run                                                    1220 passed, 8 skipped
npx expo export --platform ios                                    bundles with the module present
```

The export proves the module graph resolves. It does not exercise the fallback, because an
export does not run the code.

## Sharp edges

**The Swift has never been compiled.** There is no Swift toolchain in the environment this was
written in, so the first real check of `SurfacePool.swift`, `CodeSurfaceView.swift` and
`CodeSurfaceModule.swift` is your build. Expect to fix something.

**What to watch on device, in order.** Whether a parked surface stays warm or gets its content
process jettisoned anyway; whether claiming one mid-transition flashes; whether two warm
surfaces plus documents stays inside what iOS tolerates before it kills the process.

**Nothing pre-opens a document yet.** The reason for the pool is that a warm surface can be
handed a file before anyone taps it, and the protocol already carries `openDocument` for any
path. Wiring the file tree to do it on long-press or on scroll is the next step and is not here.

**`closeAllExcept` is still unwired.** The native host is where an iOS memory warning is
actually observable, so that belongs with a follow-up rather than with the pool itself.

## Next

1. Build, then walk the flow: warm, open, switch, background, return.
2. Pre-open documents from the file tree.
3. Wire memory pressure to `closeAllExcept`.
