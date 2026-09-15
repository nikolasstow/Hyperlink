# Agent report: Provider Settings UI (DoubleAgent iOS)

**Branch:** `app/double-agent/providers` (also pushed as `claude/providers-settings-screen-rd6ndr` — see [Branches](#branches))
**Base:** `app/double-agent/ios`
**Tip SHA:** `0c3a584b241c7810d534ba0064c51e23f17f33d5`
**Handoff:** [`provider-settings-ui-handoff.md`](../provider-settings-ui-handoff.md)
**State:** **Code complete, gate green, on-device unverified.** Nothing here has run on a phone.

Signing into any model provider — API key or OAuth — from a real UI, i.e. everything
`opencode auth login` does in the TUI. Credentials land on the opencode server the app is
pointed at (over Tailscale), not on the device: signing in authenticates *that server*, which
is why nothing is persisted locally.

---

## Shipped

| Area | Status | Evidence |
|------|--------|----------|
| **Providers row in Settings** | ✅ | `src/SettingsScreen.tsx` +15 lines, additive only |
| **`Providers` route** | ✅ | `src/RootNavigator.tsx` +5 lines, additive only |
| **Provider list + signed-in status** | ✅ | `src/ProvidersScreen.tsx` |
| **API-key sign-in** | ✅ | `src/ProviderSignIn.tsx` → `auth.set` |
| **OAuth `code` (paste) flow** | ✅ | `authorize` → open URL → paste → `callback({ method, code })` |
| **OAuth `auto` (poll) flow** | ✅ | `authorize` → open URL → poll `callback({ method })` |
| **Error surfacing on every call** | ✅ | `src/providerAuth.ts` — explicit result unions, no catch-and-default |
| **Pure-logic unit tests** | ✅ | `src/providerAuth.test.ts` — 33 tests |
| **Typecheck** | ✅ | `npx tsc --noEmit` exit 0, zero diagnostics |

1,499 insertions / 2 deletions across 9 files. Both deletions are in `package.json`, and both
are a line re-emitted with a trailing comma to admit the entry below it (`typescript` and
`bundle:check`). **No existing line of app code was removed or rewritten.**

---

## Endpoints wired

| Call | Used for |
|------|----------|
| `client.provider.list()` | Full catalog (`all`) + `connected` |
| `client.config.providers()` | Cross-referenced for signed-in status |
| `client.provider.auth()` | The auth-method menu; **array index = the `method` number** |
| `client.auth.set({ path: { id }, body: { type: "api", key } })` | API-key sign-in |
| `client.provider.oauth.authorize({ path: { id }, body: { method } })` | `{ url, method, instructions }` |
| `client.provider.oauth.callback({ path: { id }, body: { method, code? } })` | Both OAuth completions |

No server / vite / backend changes. No `packages/agent-console` or `targets/` changes.

---

## Flows implemented

| Flow | Path | Notes |
|------|------|-------|
| **api** | secure field → `auth.set` | `secureTextEntry`, paste-friendly, trimmed |
| **oauth-code** | `authorize` → `Linking.openURL` → paste code → `callback({ method, code })` | Code trimmed only — interior left intact, since Anthropic hands back a composite `code#state` the server needs verbatim |
| **oauth-auto** | `authorize` → `Linking.openURL` → poll `callback({ method })` | 2s interval, 5-minute cap, then an explicit timeout message |

v1 is code-paste + auto only, per the handoff. No deep-link redirect, no custom URL scheme,
no native config — both OAuth shapes complete against the opencode server rather than
redirecting back into the app.

**The one non-obvious rule:** `oauth.callback` answers `200 false` in two different
situations, and they mean opposite things. In the `auto` flow it means *not yet* → keep
polling. In the paste flow it means *the code was refused* → stop and say so. That split is
`CallOutcome` in `providerAuth.ts` (`ok` / `rejected` / `failed`), and it is the single piece
of logic most worth confirming against a live provider.

---

## Verified vs. pending

### Verified here

```text
$ npx tsc --noEmit
$ echo $?
0

$ npx vitest run
 Test Files  1 passed (1)
      Tests  33 passed (33)
```

- **No `as` casts anywhere.** Unknown-value reads go through the same `isRecord` type
  predicate `push.ts` already uses (`src/push.ts:44`) — a narrowing, not an assertion.
- **Every SDK call checks `.error` *and* a missing `data` separately.** The error slot is
  typed `unknown` on these endpoints, so it cannot discriminate the result union on its own.
  A failed read shows why and **keeps the previous rows** rather than rendering as "you have
  no providers", which would be a different and untrue statement.
- **Body serialization confirmed by reading the SDK**, not assumed: `jsonBodySerializer` is
  `JSON.stringify`, so an `undefined` `code` is genuinely dropped from the body. That is what
  makes the `auto` flow's `{ method }`-only call correct.

### Pending on-device — nothing below has been observed

| Item | Risk |
|------|------|
| All rendering, both colour schemes | Low — plain RN + `colors.ts`, mirrors `SettingsScreen` |
| A live API-key sign-in | Low |
| A live OAuth code paste | **Medium** — depends on the `rejected` mapping above |
| A live OAuth auto poll | **Medium** — same, plus whether opencode errors rather than returning `false` while pending |
| `useSafeAreaInsets()` inside the `Modal` | Low — context crosses the modal boundary, so it reads the root provider's insets; correct for a pageSheet in principle, unconfirmed in practice |
| iOS swipe-to-dismiss firing `onRequestClose` | Low — documented RN behaviour for `pageSheet`, unverified on RN 0.86 |
| List usability with the full catalog | **Medium** — see open decision 3 |

---

## Open decisions (owner / supervisor calls)

1. **`Linking` over `expo-web-browser`.** The latter is not a dependency and would need a
   native rebuild; `Linking.openURL` is already the app's idiom (`HtmlToolBlock.tsx:92`). An
   in-app `WebBrowser` sheet would be a nicer OAuth experience but costs a dep + rebuild.
2. **No sign-out.** `@opencode-ai/sdk@1.18.23` exposes only `auth.set` — there is no provider
   auth *removal* endpoint. Signing in again overwrites. If sign-out is wanted, it needs an
   opencode-side capability first.
3. **No search field.** `provider.list()` returns the whole models.dev catalog (hundreds of
   entries); only a handful offer an interactive sign-in. I **grouped** rather than filtered —
   *Signed in* / *Sign in* / *Other providers* — so nothing is hidden and it is pure ordering,
   not a new feature. If "Other providers" is unwieldy on-device, a search field is the fix. I
   left it out deliberately as an unrequested addition; it is the most likely follow-up.
4. **Pasted codes are trimmed only** — no URL or `code`-param extraction. Extracting `code`
   from a pasted redirect URL would silently drop `#state` and break Anthropic. If other
   providers turn out to hand back a bare URL, this needs revisiting with real examples.
5. **Scope deviation — `vitest` added to the package.** The handoff scoped work to
   `packages/agent-console-native/src/`, but also required unit tests. Running them needed
   `vitest.config.ts` + a `test` script + a `vitest` devDependency, mirroring
   `packages/agent-console` exactly. That is the `pnpm-lock.yaml` +40 lines. Revert it and
   `pnpm test` in that package works only by workspace-root ancestor resolution. **Flagging
   because it touches the shared lockfile**, which the handoff asked to keep conflict-free.

---

## Branches

The harness assigned `claude/providers-settings-screen-rd6ndr`; the handoff named
`app/double-agent/providers`. Rather than silently pick one, **the identical commit is pushed
to both.** Use `app/double-agent/providers` — it is the handoff's name and the one this report
tracks. `claude/providers-settings-screen-rd6ndr` can be deleted once that is confirmed.

Both branch from `app/double-agent/ios` (the native app does not exist on `main`).

---

## Merge-back safety

The handoff flagged the Communication Notifications workstream as the conflict risk. Shared
files were kept append-only:

| File | Change | Conflict risk |
|------|--------|---------------|
| `src/RootNavigator.tsx` | 1 import, 1 param-list entry, 1 `Stack.Screen` | Low — three separate hunks, no reflow |
| `src/SettingsScreen.tsx` | One new section inserted above `Server` | Low — no existing line touched |
| `pnpm-lock.yaml` | +40 | **Medium** — if the other agent also adds a dep |

---

## Files

| Path | Role |
|------|------|
| `packages/agent-console-native/src/providerAuth.ts` | Data layer + pure helpers (error/response narrowing, row building, grouping, validation) — 374 lines |
| `packages/agent-console-native/src/ProvidersScreen.tsx` | Provider list, grouped, with signed-in status — 273 lines |
| `packages/agent-console-native/src/ProviderSignIn.tsx` | Sign-in sheet: method menu → api / oauth-code / oauth-auto — 512 lines |
| `packages/agent-console-native/src/providerAuth.test.ts` | 33 unit tests, server-free — 263 lines |
| `packages/agent-console-native/vitest.config.ts` | Mirrors `packages/agent-console`'s config |
| `packages/agent-console-native/src/SettingsScreen.tsx` | +15 — the Providers row |
| `packages/agent-console-native/src/RootNavigator.tsx` | +5 — the `Providers` route |
| `packages/agent-console-native/package.json` | `test` script + `vitest` devDep |

---

## Next

1. **Build to a device and run the three flows against a real opencode server.** Highest-value
   check: an OAuth `auto` sign-in, to confirm opencode returns `200 false` while pending
   rather than an error. If it errors, `booleanCallOutcome`'s `failed` branch needs to
   distinguish a pending-authorization error from a real one.
2. Decide open decision 3 (search field) once the list is seen at full size.
3. Fold into `app/double-agent/ios`.

---

## Session log

**2026-09-08/09** — Built from [`provider-settings-ui-handoff.md`](../provider-settings-ui-handoff.md)
in one pass. Read the installed `@opencode-ai/sdk@1.18.23` `types.gen.d.ts` and
`bodySerializer.gen.js` directly rather than working from the handoff's type excerpts, which
is where the `undefined`-drop and `200 boolean` details came from. Two self-review fixes before
commit: an unstable `props` in the poll effect's dep array (would have torn down and restarted
the poll on every parent render), and a single-method provider flashing its own one-item menu
for a frame before entering it. `packages/agent-console-native` is **not** in the root ESLint
globs, so `tsc` + vitest are the whole gate for this package.
