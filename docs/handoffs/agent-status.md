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
| **Theme editor issues** | `fix/theme-editor-issues` | [report](./reports/2026-09-21-theme-editor-issues.md) · [inventory](./reports/2026-09-20-prototype-issue-inventory.md) | **code complete / on-device unverified** | see PR | native tsc exit 0; eslint 0 errors; 1185 tests pass | The five items left live after the owner's own theme work: three ways `createdThemes.ts` could lose a save, the picker rewriting every colour it touched from six digits to eight, and search reaching unset keys through an Add keys section that a read-only theme does not show. | 2026-09-21 |

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
