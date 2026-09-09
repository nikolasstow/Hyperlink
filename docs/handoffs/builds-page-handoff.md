# In-app Builds page — handoff

You are building a **Builds** screen for the DoubleAgent iOS app
(`packages/agent-console-native`) that shows EAS builds with the **same data the
Expo website shows** — the build list, full detail, and the **phased logs**. The
server API already exists and is verified live; you consume it.

Scope: **only `packages/agent-console-native/src/`** (a Settings entry + a nav
route + two screens + a small data helper). No server / vite / backend changes —
the `/builds` endpoints are done. Do not touch `packages/agent-console` or
`targets/`.

## The API (already built, live on the backend)

Base URL is the app's `backend` from `AppContext` (same origin as `/fs`,
`/push`, `/preview`). All read-only GET, JSON.

### `GET /builds` → `{ data: BuildRow[] }`
Newest first (up to 20). `BuildRow`:
```ts
{
  id: string
  status: "NEW" | "IN_QUEUE" | "IN_PROGRESS" | "FINISHED" | "ERRORED" | "CANCELED"
  platform?: "IOS" | "ANDROID"
  buildProfile?: string          // "development" | "preview" | "production"
  appVersion?: string
  gitCommitMessage?: string      // may be multi-line — show the first line
  artifacts?: { buildUrl?: string }   // the install (.ipa) URL when FINISHED
  app?: { slug?: string; ownerAccount?: { name?: string } }
}
```

### `GET /builds/:id` → `{ data: <full build> }`
The whole `eas build:view` object — site-parity metadata. Read what you need,
defensively (it's an open record). Useful fields: `status`, `buildProfile`,
`gitCommitHash`, `gitCommitMessage`, `appVersion`, `appBuildVersion`,
`distribution`, `createdAt` / `updatedAt` / `completedAt`,
`metrics: { buildQueueTime, buildWaitTime, buildDuration }` (ms),
`artifacts.buildUrl`, `initiatingActor.displayName`, `error` (when ERRORED).
404 `{ error }` if the id is unknown.

### `GET /builds/:id/logs` → `{ phases: Phase[] }`
The build log, grouped into phases in order — this is the site's phased log view.
```ts
type Phase = { phase: string; lines: { level: number; msg: string; time?: string }[] }
// phase e.g. "SPIN_UP_BUILDER" | "INSTALL_DEPENDENCIES" | "RUN_FASTLANE" | "XCODE" | …
// level: 30 = info, 40 = warn, 50 = error
```
A finished build returns ~28 phases. For an in-progress build, phases fill in as
it runs — **poll** this while `status` is `IN_QUEUE`/`IN_PROGRESS` to tail it.

## Build (screens)

Mirror how the Providers screen was added (Settings section row → route →
screen). See `SettingsScreen.tsx` (the "Model providers" row calling
`navigation.navigate("Providers")`) and the `Providers` route in
`RootNavigator.tsx`.

1. **Settings entry** — a new "Builds" section/row in `SettingsScreen.tsx`
   (append-only) → `navigation.navigate("Builds")`.
2. **Route** — register `Builds` (list) and `BuildDetail: { id: string }` in
   `RootNavigator.tsx`'s `RootStackParamList` + `Stack.Navigator` (append-only,
   so it merges back into `app/double-agent/ios` cleanly).
3. **`BuildsScreen`** — the list. Each row: a **status pill** (color by status —
   green FINISHED, red ERRORED, blue/spinner IN_PROGRESS/IN_QUEUE, grey
   CANCELED), platform + profile, the commit message's first line, and relative
   time. Tap → `BuildDetail`. Pull-to-refresh; auto-poll (~10s) while any build
   is non-terminal.
4. **`BuildDetailScreen`** — full metadata header (status, profile, versions,
   commit, durations from `metrics`, timestamps) + an **Install** action on
   `artifacts.buildUrl` when FINISHED (`Linking.openURL`) + the **phased log
   view**: collapsible sections per phase, monospaced lines, colored by `level`
   (40 warn, 50 error). Auto-tail (poll `/logs`) while the build is in progress;
   stop polling once terminal.
5. **`builds.ts`** — a small data helper: typed fetchers for the three endpoints
   that read `backend` and narrow responses defensively (no casts). Put pure
   bits (status→color, relative time, phase/level formatting) here and unit-test
   them.

## Standards (enforced — same gate as the Providers screen)

- **No `as` casts.** Narrow `unknown` with an `isRecord` predicate (see
  `src/push.ts:44`), not assertions. No non-null `!` either — restructure.
- **Never hide errors.** `fetch` responses: check `response.ok` explicitly and
  surface failures; on a failed refresh keep the previous rows rather than
  rendering "no builds" (which would be untrue). No catch-and-default-to-empty.
- **One field per line** in multi-field objects/params. **camelCase** values,
  **PascalCase** only for types/components.
- Match the app's design — `colors.ts`, the existing Settings rows / section
  headers. No new design system, no unrequested extras.
- **Prefer no new dependency.** The phased log view is plain RN (`ScrollView` +
  `Text`, monospace via `fontFamily: "Menlo"`); it needs nothing new. Avoid
  touching `package.json` / `pnpm-lock.yaml` unless truly required (it's the one
  shared-file conflict risk). Effect patterns where they don't force a rewrite.
- Gate: `cd packages/agent-console-native && npx tsc --noEmit` (exit 0) and
  `npx vitest run` (all passing). `packages/agent-console-native` is **not** in
  the root ESLint globs, so tsc + vitest are the whole gate.

## Verification

You can't hit a device or a live build from the cloud, but the API is live — you
can develop against a running backend if one is reachable, otherwise mock the
shapes above. Unit-test the pure helpers (status color, relative time, phase
grouping/formatting). State clearly what's verified vs. pending on-device.

## Git

- The native app exists only on `app/double-agent/ios`, **not `main`** — branch
  from **`app/double-agent/ios`** → `app/double-agent/builds`.
- One branch; commit at sensible points; push. Keep `SettingsScreen.tsx` /
  `RootNavigator.tsx` diffs additive and localized for a clean merge back.
- Final report under `docs/handoffs/reports/` (mirror the Providers report):
  files, endpoints wired, what's verified vs. pending, open decisions. Add your
  row to `docs/handoffs/agent-status.md` (only your row).

## Context

- There's already a build-completion **notification** (server pushes when a
  build finishes, linking to the expo.dev page) — this screen is the richer
  in-app view, not a replacement.
- Related design docs (page/layout conventions) exist under `docs/handoffs/`
  (`page-layout-design.md`, `view-page-naming.md`) if you want the house style;
  the Providers screen is the most direct, recent precedent to copy.
