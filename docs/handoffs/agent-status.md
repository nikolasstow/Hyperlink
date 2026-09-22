# DoubleAgent — agent status board

One row per parallel workstream. Owners update their own row; keep edits to your
own row so this file doesn't become a merge conflict between agents.

| Workstream | Branch | Docs | State | Tip | Gate | Open / blocking | Updated |
|---|---|---|---|---|---|---|---|
| **Communication Notifications + Siri + build notify + hosted previews** | `app/double-agent/ios` | [comms research](./communication-notifications-research.md) · [Siri survey](./siri-app-intents-survey.md) | **code complete / needs one native rebuild** | `029847a7` | tsc exit 0 (server + native); preview endpoint smoke-tested; prebuild wires all 3 extensions | On-device unverified pending rebuild: comm-notification styling, hands-free voice reply, Stop-button fix, Safari-view preview. Build-complete push is live server-side. | 2026-09-09 |
| **Providers UI** | `app/double-agent/providers` | [report](./reports/2026-09-09-provider-settings-ui.md) · [handoff](./provider-settings-ui-handoff.md) | **reverted by owner** | `92e37f9` | n/a | The merge into `app/double-agent/ios` was reverted at the owner's direction. The trunk carries no providers code; the branch is kept as the record. Do not re-merge without an explicit go. | 2026-09-20 |
| **In-app Builds page** | `app/double-agent/builds` (PR #82) | [handoff](./builds-page-handoff.md) | **built / open PR / on-device unverified** | see PR | tsc 0 | Install opens the raw `.ipa`, which iOS cannot install from; the EAS build page URL is derivable from fields `/builds` already returns. Rows carry no timestamp until `asBuildRow` gains one ([trunk handoff](./ios-trunk-followups-handoff.md), item 2). | 2026-09-20 |
| **Theme editor** | `feat/theme-editor` → **merged** into `app/double-agent/ios` (`a3bd389e`, PR #87) | [report](./reports/2026-09-20-theme-editor.md) | **merged / on-device unverified** | `a3bd389e` | eslint 0 errors 1 warning; both app tsc exit 0; 1161 tests pass (105 of them never ran before) | Follow-ups tracked in the [issue inventory](./reports/2026-09-20-prototype-issue-inventory.md), section B. First on a device: the `Host` recycling hazard in the colour-picker list. | 2026-09-20 |
| **Issue sweep 2026-09-20** | `app/double-agent/ios` (docs only) | [trunk handoff](./ios-trunk-followups-handoff.md) · [prototype inventory](./reports/2026-09-20-prototype-issue-inventory.md) | **routed** | `a3bd389e` | measured on the trunk, recorded in both docs | Issues in the iOS trunk agent's area were routed to the handoff; everything else is held by the prototype agent. Highest priority is the toolkit gate: `pnpm verify` is red on the clean base with 8 errors. | 2026-09-20 |
| **Code surface Phase 0** | `feat/code-surface-phase0` → **merged** into `app/double-agent/ios` (PR #90) | [report](./reports/2026-09-21-code-surface-phase0.md) · [handoff](./agent-console-code-surface-phase0.md) | **merged / on-device unverified** | see PR #90 | both app tsc exit 0; eslint 0 errors; tests pass; asset rebuilds byte-identical | Phase 0 is JavaScript only, so no rebuild: monaco, `@shikijs/monaco` and esbuild are devDependencies and `expo-asset` already ships with `expo`. Verified in Chromium against the built asset, not on a device — the one thing to watch is the asset actually loading in the WebView on hardware. Custom code fonts stay unrendered until `expo-font` lands, so the surface keeps matching the chat blocks. | 2026-09-21 |
| **Code surface documents** | `feat/code-surface-documents` (on `fix/code-surface-full-editor`) | [report](./reports/2026-09-22-code-surface-documents.md) | **code complete / on-device unverified** | see PR | native tsc 0; eslint 0 errors; 1220 tests pass | One Monaco model per file, so switching back keeps scroll position and undo history. Budget is 4 MB of text or 12 documents, measured: a model costs its own text until displayed, then 0.7 to 3.8 MB. Does not speed up the first open; that needs the native host in step 2. | 2026-09-22 |
| **Code surface native host** | `feat/code-surface-native-host` (on documents + full-editor) | [report](./reports/2026-09-22-code-surface-native-host.md) | **code complete / Swift never compiled** | see PR | native tsc 0; eslint 0 errors; 1220 tests; `expo export` bundles | A pool of WKWebViews that outlive the screens showing them, so a file opens against an already-parsed surface. Needs an EAS build to do anything; falls back to the react-native-webview host until then, so nothing breaks before it. No Swift toolchain here, so the build is its first compile. | 2026-09-22 |
| **Theme editor issues** | `fix/theme-editor-issues` → **merged** into `app/double-agent/ios` (PR #91) | [report](./reports/2026-09-21-theme-editor-issues.md) · [inventory](./reports/2026-09-20-prototype-issue-inventory.md) | **merged / on-device unverified** | see PR #91 | native tsc exit 0; eslint 0 errors; tests pass | The five items left live after the owner's own theme work: three ways `createdThemes.ts` could lose a save, the picker rewriting every colour it touched from six digits to eight, and search reaching unset keys through an Add keys section that a read-only theme does not show. | 2026-09-21 |
| **DoubleAgent to integration** | `app/double-agent/ios` (docs only) | [handoff](./double-agent-to-integration.md) | **handoff ready / not started** | `eeb04fdc` | n/a | `app/double-agent/ios` shares no ancestor with `integration` or `main`: 234 commits from a root of its own dated 2026-09-04. 1641 files are common, 143 of them differ, and only 3 matched integration's tip at the ios root, so neither side is safely the winner. Merge PRs #95, #92, #93, #94 first; close #89. | 2026-09-22 |

## Rulings on the Providers UI open decisions (2026-09-09)

1. **`Linking` vs `expo-web-browser`** — keep `Linking` for v1. Note: the Comms
   workstream has *added* `expo-web-browser` to the app (for the hosted-preview
   Safari view), so once that lands in a build, the OAuth flow can be upgraded to
   an in-app Safari view for free. Low priority; not a v1 blocker.
2. **No sign-out** — accepted. `@opencode-ai/sdk@1.18.23` has only `auth.set`, no
   removal endpoint; signing in again overwrites. Revisit if opencode adds a
   capability. Document it in the screen (a one-line note is fine).
3. **No search field** — ship grouped (*Signed in / Sign in / Other providers*)
   without search for v1. Decide after seeing "Other providers" at full size on
   device; a search field is the fix if it's unwieldy. Correct call to leave out.
4. **Pasted codes trimmed only** — keep as-is. Extracting `code` from a pasted
   URL would drop Anthropic's `#state`. Revisit only with a real counter-example.
5. **vitest + lockfile change** — **keep it.** 33 tests are worth the setup, and
   it mirrors `packages/agent-console`. The lockfile conflict is now real anyway
   (Comms added `expo-web-browser`), so the merge resolves it by taking both
   `package.json` edits and running `pnpm install` to regenerate the lock — not
   by reverting either side.

## Merge-back plan (Providers → `app/double-agent/ios`)

Shared files: `RootNavigator.tsx` (their +5 route lines vs. my import/effect
edits — different hunks, expect a trivial import-block resolution),
`SettingsScreen.tsx` (their additive section — clean), `pnpm-lock.yaml` (resolve
via `pnpm install` after taking both `package.json` changes). Then `tsc` + vitest
must stay green before the fold is done.
