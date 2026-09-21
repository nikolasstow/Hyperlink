# Agent report: code surface Phase 0

**Branch:** `feat/code-surface-phase0`
**Base:** `app/double-agent/ios` (`4feb7803`)
**Handoff:** [`agent-console-code-surface-phase0.md`](../agent-console-code-surface-phase0.md)
**SSOT:** [`extensions-sync-and-theming.md`](../extensions-sync-and-theming.md), "Code highlighting, decisions"
**State:** Code complete. The gate is green. The surface is verified in a real browser; it has not run on a device.

Files open in Monaco, read-only, themed by the same VS Code theme and the same
TextMate grammars the chat code blocks tokenize with. Editing is one constant,
on this same instance.

## Before acting on this report

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This report is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## Phase 0 stayed JavaScript only, so no rebuild

The handoff asked this to be confirmed rather than assumed.

| Package | Role | Native? |
|---------|------|---------|
| `monaco-editor@0.56.0` | The editor, bundled into the asset | No, and a devDependency: only the build step reads it |
| `@shikijs/monaco@4.4.2` | Hands Monaco Shiki's grammars and theme | No, devDependency, and its version matches the installed `shiki@4.4.2` exactly |
| `esbuild` | Builds the asset | No, devDependency |
| `expo-asset` | Resolves the asset to a file on disk | Already a dependency of `expo@57.0.16`, so already in the binary |
| `react-native-webview@13.16.1` | Already installed | Already in the binary |

Nothing the app ships at runtime is new except `expo-asset`, which the installed
`expo` already pulls in. `react-native-webview` carries the file-access props
this needs (`allowFileAccess`, `allowingReadAccessToURL`,
`allowFileAccessFromFileURLs`).

## How it is put together

| Path | Role |
|------|------|
| `webview/codeSurface.ts` | The surface. Monaco, Shiki, the grammars, the message handlers. Not part of the React Native bundle. |
| `scripts/gen-code-surface.mjs` | esbuild over that entry, output inlined into the asset. `pnpm gen:code-surface`. |
| `assets/code-surface.html` | Generated, committed, 3.61 MB. One self-contained document. |
| `src/codeSurfaceProtocol.ts` | The messages, parsed and checked in both directions. No React Native, no DOM, so both sides and the tests import it. |
| `src/codeSurfaceProtocol.test.ts` | 31 tests. |
| `src/CodeSurface.tsx` | The WebView and the bridge. |
| `src/FileViewerScreen.tsx` | Rewired onto it. |
| `src/assets.d.ts` | `.html` is an asset module, which Metro knows and TypeScript does not. |

**Everything is inline in one file.** Metro treats `.html` as an asset and `.js`
as source, so a script beside the page would end up inside the app bundle
instead of next to it, and a WebView on a `file://` page cannot reliably pull
sibling resources on iOS. One document sidesteps both and is what makes the
airplane-mode requirement hold: there is nothing to fetch.

**The grammars are in the asset, not sent across the bridge.** A TextMate
grammar is megabytes of JSON and the surface needs them before its first frame.
That is a second copy of the same eleven grammars the React Native side already
bundles, which the architecture implies rather than something this introduces.

**Read-only is a message.** `READ_ONLY` in `CodeSurface.tsx` is sent as
`setReadOnly`. Phase 1 is that constant becoming `false` on the same Monaco
instance, which is what keeps language intelligence, inline completions and
collaborative editing additive.

## Two defects the browser run caught

Both would have shipped to the device.

**Monaco refuses most theme names.** `defineTheme` validates against
`/^[a-z0-9-]+$/i` and throws `Illegal theme name!` otherwise. `useCodeTheme`
names an installed theme after the file it was read from, so every installed
theme would have thrown, silently leaving the surface on its bundled fallback.
`monacoThemeName` leaves a name Monaco already accepts alone, so `github-dark`
stays itself, and slugs anything else with a digest of the original appended so
two themes cannot collapse into one.

**An empty `settings` would have lost every token rule.** Shiki moves
`tokenColors` into `settings` only when `settings` is absent
(`normalizeTheme`, `@shikijs/primitive`), and its raw theme type requires
`settings`. Supplying `[]` to satisfy the type would have type-checked and then
dropped the colours, because an empty array is not absent. `toShikiTheme`
applies Shiki's own rule where it can be seen.

## Verified in a browser

Chromium, driving the built asset over `file://` with the same message protocol
the app sends.

| Checked | Result |
|---------|--------|
| Boot to `ready` | 22 ms |
| A theme named `themes/Night Owl-color-theme.json` | Applies; background `#011627` as written |
| Token colours against a theme document with `tokenColors` and no `settings` | Keywords, strings and comments each take the theme's colour and italics |
| Read-only | Clicking in and typing changes nothing |
| A 20,000 line file | First paint 101 ms, 37 line elements rendered, so virtualization is intact |
| `scrollTo` line 9000 | Gutter reveals 8981 to 9018 |
| Content carrying `U+2028`, `U+2029`, `</script>`, backticks and quotes | Renders intact, no script error |
| Page and surface errors | None |

## Verified in the repo

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx tsc --noEmit -p packages/agent-console/tsconfig.json          exit 0
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 pre-existing warning
npx vitest run                                                    1192 passed, 8 skipped
npx expo export --platform ios                                    assets/code-surface.html (3.8MB) listed
```

The root project still reports the eight toolkit errors that predate this
branch. They are fixed on `fix/toolkit-typecheck`, unmerged, and none of them
are in this diff.

## Sharp edges

**Nothing has run on a device.** A browser is not WKWebView. What to watch for
first: whether the asset resolves under a release build as it does under Metro,
and how the surface feels inside a navigation stack.

**Custom code fonts are still not rendered, here or anywhere.** A custom font
needs `expo-font`, which is not in the binary, so the chat blocks cannot render
one either. The surface could render one through `@font-face` today, and
deliberately does not: matching the chat blocks is a hard requirement of the
handoff and getting ahead of them would break it. The `setFont` message already
carries a `source`, and `injectFontFace` is written, so the day `expo-font`
lands this needs no protocol change.

**Lines do not wrap.** That matches the viewer it replaces, which scrolled
horizontally, but a phone is narrow and this is worth a judgement on device.

**The asset is committed and regenerating it rewrites 3.61 MB.** It is generated
rather than built during EAS, because an EAS build installs and bundles and does
not run scripts. Re-run `pnpm gen:code-surface` after touching
`webview/codeSurface.ts` or bumping monaco, shiki or `@shikijs/monaco`.

## Next

1. Build to a device and open a file in each of the bundled languages.
2. Decide on wrapping.
3. Phase 1 is `READ_ONLY` becoming false plus a save through `/fs/write`.
