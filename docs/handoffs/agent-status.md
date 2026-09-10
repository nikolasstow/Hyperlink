# DoubleAgent — agent status board

One row per parallel workstream. Owners update their own row; keep edits to your
own row so this file doesn't become a merge conflict between agents.

| Workstream | Branch | Docs | State | Tip | Gate | Open / blocking | Updated |
|---|---|---|---|---|---|---|---|
| **Communication Notifications + Siri + build notify + hosted previews** | `app/double-agent/ios` | [comms research](./communication-notifications-research.md) · [Siri survey](./siri-app-intents-survey.md) | **code complete / needs one native rebuild** | `029847a7` | tsc exit 0 (server + native); preview endpoint smoke-tested; prebuild wires all 3 extensions | On-device unverified pending rebuild: comm-notification styling, hands-free voice reply, Stop-button fix, Safari-view preview. Build-complete push is live server-side. | 2026-09-09 |
| **Providers UI** | `app/double-agent/providers` → **merged** into `app/double-agent/ios` | [report](./reports/2026-09-09-provider-settings-ui.md) · [handoff](./provider-settings-ui-handoff.md) | **merged; on-device unverified** | `92e37f9` | tsc exit 0; 33/33 vitest (green post-merge) | On-device OAuth `auto` flow unconfirmed (does opencode return `200 false` while pending, or an error?); search field is an owner call — ruled below | 2026-09-09 |
| **In-app Builds page** | _(to be cut)_ `app/double-agent/builds` | [handoff](./builds-page-handoff.md) | **handoff ready / not started** | — | — | Server `/builds` + `/builds/:id` + `/builds/:id/logs` API is live on `app/double-agent/ios`; native page consumes it. For an additional agent. | 2026-09-09 |

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
