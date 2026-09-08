# Provider Settings UI — handoff

You are building a **Providers** settings screen for the DoubleAgent iOS app
(`packages/agent-console-native`, Expo/React Native talking to an opencode
server). It lets the user sign into any model provider — API key or OAuth —
from a proper UI, i.e. everything `opencode auth login` does in the TUI.

This is a self-contained feature. It touches only
`packages/agent-console-native/src/` (a new screen + a Settings entry + a nav
route). **No server / vite / backend changes** — the app talks to opencode
directly via the SDK client. Do not modify `packages/agent-console` or the
`targets/` native extensions; another agent owns those.

## Where it plugs in

- The opencode client is `src/client.ts` (`makeClient` →
  `createOpencodeClient`). Get the live client the same way existing screens do
  (they read the configured server address from `settings.ts` / `AppContext`
  and build/consume the client — follow `SessionChatScreen.tsx` /
  `RepoSessions` for the exact pattern; don't invent a second client).
- Add a **"Providers"** row to `src/SettingsScreen.tsx` that navigates to a new
  `ProvidersScreen`.
- Register the `Providers` route in `src/RootNavigator.tsx`'s `Stack.Navigator`
  (mirror the existing `Chat` screen registration).
- New files: `src/ProvidersScreen.tsx` (list + status), a sign-in flow
  (`src/ProviderSignIn.tsx` or a sheet), and any small pure helpers.

## The opencode auth surface (all on the SDK `client`)

Credentials are stored on **the opencode server the app is pointed at** (over
Tailscale), which is exactly right — signing in authenticates that server.

### Discovery / status
- `client.provider.list()` → all known providers (id, name, models).
- `client.config.providers()` → providers currently available/configured on the
  server (use to show which are already signed in).
- `client.provider.auth()` → the auth-method menu, shape:
  ```ts
  { [providerID: string]: Array<{ type: "oauth" | "api"; label: string }> }
  ```
  The **array index** of a method is the `method` number the OAuth calls take.

### API-key sign-in
```ts
await client.auth.set({
  path: { id: providerID },
  body: { type: "api", key: apiKey },   // ApiAuth
})
// → 200 boolean
```

### OAuth sign-in (two shapes, driven by the authorize response)
```ts
const { data } = await client.provider.oauth.authorize({
  path: { id: providerID },
  body: { method },                      // index from provider.auth()
})
// data: { url: string; method: "auto" | "code"; instructions: string }
```
- `method: "code"` → open `data.url` in the browser (expo-web-browser /
  Linking), user copies the code shown, pastes it back into a text field, then:
  ```ts
  await client.provider.oauth.callback({
    path: { id: providerID },
    body: { method, code },
  })
  ```
- `method: "auto"` → device-style flow: open `data.url`, then call
  `oauth.callback({ path: { id }, body: { method } })` (no `code`) to complete;
  poll it on an interval until it resolves (show a "waiting for
  authorization…" state). Respect `data.instructions` in the UI copy.

**Start with the `code` (paste) and `auto` flows** — neither needs a custom URL
scheme / deep-link redirect, so no native config. A redirect-based flow is a
later enhancement, not v1.

## UX

- **List:** every provider from `provider.list()`, each showing signed-in vs not
  (cross-reference `config.providers()`), the provider name, and a tap target.
- **Tap a provider →** if it has one auth method, go straight into it; if it has
  several (`provider.auth()` returns >1), let the user pick (e.g. "Sign in with
  OAuth" / "Use API key").
- **API key:** secure text field (`secureTextEntry`), paste-friendly, a Save
  button that calls `auth.set`, success/failure feedback.
- **OAuth code flow:** "Open sign-in page" button (opens `url`) + a code field +
  Connect button.
- **OAuth auto flow:** "Open sign-in page" then an automatic "waiting…" spinner
  that resolves on callback.
- On success, refresh the list so the provider flips to signed-in.
- Match the app's existing visual language (`colors.ts`, the Settings rows, the
  sheet/menu components already in `src/`). Don't introduce a new design system.

## Standards (enforced — read before coding)

- **Effect / Last.ts direction:** this is a `src/` React Native screen, held to
  the relaxed browser/React ruleset, not strict Effect rules. But any
  non-trivial async orchestration or data layer you add should follow the
  project's Effect patterns where it doesn't force a wider rewrite (see how
  `fsClient.ts` / `repoScan.ts` / `effect/runtime.ts` wrap SDK/HTTP work in
  Effect). If a boundary would force a big rewrite, leave a note rather than
  ballooning scope.
- **No `as` casts anywhere.** Fix types structurally. The SDK responses are
  typed; narrow with guards, don't cast.
- **Never hide errors.** The SDK client does NOT throw on HTTP errors by
  default — check `.error` explicitly on every call and surface it. No
  catch-and-default-to-empty.
- **One field per line** in multi-field objects/params; don't collapse them.
- **camelCase values, PascalCase only for types/components.**
- **No unrequested additions** — build the providers UI, not extra polish copy.
- Typecheck must pass: `cd packages/agent-console-native && npx tsc --noEmit`.
  Test any pure helpers you extract.

## Verification

- You can't test against a physical device or a live provider sign-in from the
  cloud. So: make `tsc` clean, unit-test pure logic (method selection, response
  narrowing, URL/code validation), and structure the screen so on-device
  verification at integration is straightforward. State clearly in your final
  report what is and isn't verified.

## Branch / integration

- Branch from **`main`** (not the current app branch): `app/double-agent/providers`.
- Keep all work on that one branch; commit at sensible points and push.
- The other workstream (Communication Notifications) is on
  `app/double-agent/ios` and touches different files; conflicts should be
  minimal. If you must touch `SettingsScreen.tsx` / `RootNavigator.tsx`, keep
  the diffs additive and localized so integration is a clean merge.
- Final report: list the new files, the endpoints wired, the exact flows
  implemented (api / oauth-code / oauth-auto), what's verified vs pending
  on-device, and any open decisions.

## Reference: exact SDK types (from `@opencode-ai/sdk` types.gen)

```ts
type ProviderAuthMethod = { type: "oauth" | "api"; label: string }
type ProviderAuthAuthorization = { url: string; method: "auto" | "code"; instructions: string }
type ApiAuth = { type: "api"; key: string; metadata?: Record<string,string> }
// auth.set body is Auth = OAuth | ApiAuth | WellKnownAuth; use ApiAuth for key sign-in.
// provider.auth() response: { [providerID]: ProviderAuthMethod[] }
```
</content>
