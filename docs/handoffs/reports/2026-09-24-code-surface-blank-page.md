# Code surface blank page (2026-09-24)

**Agent:** prototype (`fix/code-surface-blank-page`).
**Package:** `packages/agent-console-native` (DoubleAgent iOS).
**Status:** Fixed on the work branch, PR open against `app/double-agent/ios`. The prevention that
would have caught it is not built yet and is proposed at the end of this report.

Owner report: "Unfortunately, I got a blank page for the editor/viewer should be." No error, no
spinner, no message. The file viewer rendered an empty frame.

---

## What happened

1. **Phase 0 shipped a navigation guard that refuses the page's own first load.** `CodeSurface.tsx`
   passed the WebView this:

   ``` tsx
   onShouldStartLoadWithRequest={(request) => request.url === uri || request.url === "about:blank"}
   ```

   `uri` is what `expo-asset` resolves the built `code-surface.html` to, and on device that is
   `file:///var/mobile/Containers/Data/Application/.../ExponentAsset-<hash>.html`.

2. **iOS symlinks `/var` to `/private/var`.** WKWebView reports the navigation with the resolved
   path, so the URL that reaches the guard is
   `file:///private/var/mobile/Containers/Data/Application/.../ExponentAsset-<hash>.html`. Same
   file, different string. The equality fails.

3. **A false there is a cancelled navigation.** `RNCWebViewImpl.m` routes every
   `decidePolicyForNavigationAction` through `onShouldStartLoadWithRequest`, and turns a false into
   `WKNavigationActionPolicyCancel`. The page never starts loading.

4. **A cancelled navigation raises no error.** WebKit does not call
   `didFailProvisionalNavigation` for a policy the host itself declined, so there was nothing for
   `onError` to fire from even if the host had been listening. It was not: the WebView carried no
   `onError`, no `onHttpError`, no `onContentProcessDidTerminate`.

5. **Nothing else was listening either.** The page reports `ready` when Monaco is constructed, and
   the host used that only to drain its message queue. A surface that never said `ready` was
   indistinguishable from one still parsing five and a half megabytes of Monaco. There was no
   deadline. The native host (`modules/code-surface`) had no failure path at all: its web view
   starts loading inside `SurfacePool`, before any React view exists to hear about it.

So the defect was two defects. One guard that cancelled the load, and a host with no way to notice
that anything had gone wrong. The second is the reason it reached the owner rather than a log line.

---

## Which path the owner was on

The guard only exists on the `react-native-webview` path. A build with the native module compiled in
loads through `WKWebView.loadFileURL` with no navigation delegate, so the guard is never consulted
there. That means one of two things, and the evidence on hand does not separate them:

| Build | What the blank page was |
|-------|-------------------------|
| Without the native module (Expo Go, or a binary predating PR #94) | The cancelled navigation above. Confirmed by reading, reproduced in the protocol tests. |
| With the native module | Something else, which nothing in the app was equipped to report. |

The fix covers both. If it is the second, the next report arrives with a reason attached instead of
an empty frame.

---

## The fix

| Change | Why |
|--------|-----|
| `isSurfaceNavigationAllowed` in `codeSurfaceProtocol.ts`, a scheme test | `file://` or `about:blank`. The same door the guard was there to shut: nothing in the page navigates, a tapped link is reported to the host, and the page's CSP allows no remote origin. Tested, since it is pure. |
| `onError` / `onHttpError` / `onContentProcessDidTerminate` on the WebView | The three ways the WebView path can fail out loud. |
| `SurfaceLoadObserver` in `SurfacePool.swift` | The navigation delegate the pooled web view never had. A failure is remembered, not only announced, because the load begins with no view attached; whichever view claims that surface is told at once. A surface whose page failed is reloaded on claim rather than handed out dead. |
| An error before `ready` is fatal and shown | After `ready` it is not, and the page keeps whatever it last rendered. |
| `loadFailed`, a second message kind the page never sends | An `error` is the page reporting something it survived. A web view whose content process died cannot report its own absence, so the host says it instead, and it is fatal whenever it arrives. Without the split, a process killed an hour in was dropped on the floor by the rule above. Found by Cursor Bugbot on the first review of this branch. |
| A fifteen second deadline on `ready` | The one that does not depend on knowing the cause. A late `ready` clears it. |

---

## Why it escaped

This is the part worth keeping.

1. **The page was verified, the host was not.** Every check on the code surface ran in headless
   Chromium under Playwright: theme registration, the Shiki `settings` collapse, selection under
   `readOnly`, the boot timings. Chromium has no `/var` symlink and no WKWebView navigation policy,
   so `onShouldStartLoadWithRequest` is not code that exists there. The probe loop that caught three
   real defects could not see this one, because this one lives on the other side of the bridge.

2. **No device and no simulator in the environment.** Nothing in this session has ever run the app.

3. **No DoubleAgent branch has ever been gated by CI.** `verify.yml` runs on `ubuntu-latest` and
   triggers on `integration` and `cursor/**`. No Swift in this repository has ever been compiled by
   CI.

4. **PR #95 would not have caught this either.** It compiles the iOS app on macOS, which is worth
   having and catches a stale generated asset. It does not launch anything. A guard that cancels a
   navigation compiles perfectly.

---

## What would catch the next one

A simulator test, hanging off the build job PR #95 adds. Boot the built app on
`iPhone 16` / latest iOS, open a file, and assert the surface reports `ready` inside the deadline.
That single assertion covers the whole class: a cancelled navigation, a missing asset, a page that
throws during boot, a content process that dies. All of them are now a `ready` that does not arrive,
which is exactly what the host measures.

Until that exists, the standing rule for this package: **a Chromium probe proves the page, never the
host.** Navigation policy, asset URLs, view lifecycle, and anything in `modules/` are unverified
claims until a simulator runs them, and a report that says otherwise is overstating what was
checked.
