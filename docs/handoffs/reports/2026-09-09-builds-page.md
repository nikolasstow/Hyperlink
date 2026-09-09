# Agent report: In-app Builds page (DoubleAgent iOS)

**Branch:** `app/double-agent/builds`
**Base:** `app/double-agent/ios` (`0af91fa`)
**Tip SHA:** `60db378`
**Handoff:** [`builds-page-handoff.md`](../builds-page-handoff.md)
**State:** **Code complete, gate green, on-device unverified.** Nothing here has run on a phone
or against a live backend.

EAS builds in the app, with the data expo.dev shows: the list, the full
`eas build:view` record, and the phased log. Consumes the `/builds` API that already
shipped in `11a5bb4`; no server change.

---

## Shipped

| Area | Status | Evidence |
|------|--------|----------|
| **Builds row in Settings** | ✅ | `src/SettingsScreen.tsx` +15, insertions only |
| **`Builds` + `BuildDetail` routes** | ✅ | `src/RootNavigator.tsx` +9, insertions only |
| **List: status pill, platform/profile, commit subject** | ✅ | `src/BuildsScreen.tsx` |
| **Pull-to-refresh** | ✅ | `RefreshControl` |
| **Auto-poll ~10s while non-terminal** | ✅ | `hasActiveBuild` gates the interval; torn down when all terminal |
| **Detail: metadata header** | ✅ | `src/BuildDetailScreen.tsx` — profile, platform, version, distribution, commit, actor, metrics, timestamps |
| **Install action on `artifacts.buildUrl` when FINISHED** | ✅ | `Linking.openURL` — but see open decision 2 |
| **Collapsible phased log, monospace, coloured by level** | ✅ | Menlo; no new dependency |
| **Auto-tail while in progress** | ✅ | `/logs` re-read on the same interval; newest phase seeded expanded |
| **Typecheck** | ✅ | `npx tsc --noEmit` exit 0, zero diagnostics |
| **Unit tests** | ✅ | 78 passing (44 new for builds, 33 pre-existing Providers, +1) |

1,626 insertions / 1 deletion across 9 files. The single deletion is the `warning:` line in
`colors.ts` re-emitted to admit the new token below it. **No existing line of app code was
removed or rewritten.**

---

## Endpoints wired

| Call | Used for |
|------|----------|
| `GET {backend}/builds` | List (`{ data: BuildRow[] }`), newest first |
| `GET {backend}/builds/:id` | Full detail (`{ data }`), narrowed defensively |
| `GET {backend}/builds/:id/logs` | `{ phases: [{ phase, lines }] }`, rendered as the phased view |

Base is `backend` from `AppContext`, same origin as `/fs` and `/push`. All GET, read-only.
No server / vite / backend changes; `packages/agent-console` and `targets/` untouched.

---

## Design notes worth knowing

**`status` is kept a raw string, not a six-literal union.** EAS owns that vocabulary and can
add to it. Narrowing to the documented six would make a *new* status silently read as one of
the old ones — and worse, `isTerminalStatus` would have to guess. It answers `false` for
anything unrecognised, so an unknown status keeps polling rather than freezing a live build's
screen at a stale snapshot.

**`builds.ts` imports nothing from React Native, on purpose.** `colors.ts` resolves
`PlatformColor` at import time, so pulling it in would make the module unloadable under
vitest. The presentation helpers therefore return a *tone* (`"success"`, `"danger"`, …) and
`BuildStatusPill.tsx` is the single place that turns a tone into a colour. That is what makes
44 of the 78 tests possible.

**Log volume is real and is handled.** A finished iOS build's `RUN_FASTLANE` phase runs to
thousands of lines, and React Native lays out every `Text` in an expanded `ScrollView`
eagerly. Phases render collapsed by default, each showing its line count and the worst level
it contains — a red marker finds the failing phase without opening the other 27 — and an
expanded phase renders at most `LOG_LINE_LIMIT` (500) lines, keeping the **tail**, with
`… N earlier lines not shown` above it. Head-truncation would have hidden exactly the lines
that matter.

**`colors.ts` gains one token: `success`.** The only existing green is `brand`, which
`colors.ts` documents as the identity colour and explicitly expects to change when real brand
colours land — a FINISHED pill painted with it would silently repaint. One additive line
rather than a latent bug.

---

## Verified vs. pending

### Verified here

```text
$ npx tsc --noEmit ; echo $?
0

$ npx vitest run
 Test Files  2 passed (2)
      Tests  78 passed (78)
```

- **No `as` casts and no non-null `!`** in any new file — grepped, not assumed. Every read off
  the open `eas build:view` record goes through the `isRecord` predicate from `push.ts:44`.
- **`response.ok` checked explicitly on all three endpoints.** `fetch` rejects only on a
  transport failure, so without that an HTML error page would be parsed as data. A failed
  refresh keeps the rows already on screen and shows why; it never renders "No builds yet",
  which would be untrue.
- **Detail and log failures are reported separately.** A queued build has metadata but no log;
  a log failure must not blank the header.
- Narrowing is tested against the shapes `buildsPlugin.ts` actually emits, including malformed
  ones: wrong-typed fields, missing `id`/`status`, `phases: "nope"`, an `error` given as a
  string vs. `{ message }` vs. `{ errorCode, message }`.

### Pending on-device — none of this has been observed

| Item | Risk |
|------|------|
| All rendering, both colour schemes | Low — plain RN + `colors.ts`, mirrors the Providers screen |
| List against a real 20-build payload | Low |
| Detail against a real `eas build:view` record | **Medium** — it is an open record; field names are from the handoff, not from a live response I read |
| Phased log at real volume (~28 phases) | **Medium** — the 500-line cap is reasoned, not measured |
| Whether **Install** actually installs | **High** — see open decision 2 |
| Auto-poll behaviour across backgrounding | Low — `setInterval` is suspended and resumed by iOS |

---

## Open decisions

1. **The list has no timestamp, because the API does not carry one.** The handoff asks each row
   to show relative time, but `/builds` rows have no `createdAt` — `asBuildRow` in
   `buildsPlugin.ts` does not copy it, and the handoff's own `BuildRow` spec omits it. I
   implemented the read defensively (`createdAt` is narrowed if present) and render nothing
   when absent, rather than dropping the feature silently or fetching detail for 20 rows. **One
   line on the server lights it up:** add `createdAt: typeof value.createdAt === "string" ?
   value.createdAt : undefined` to `asBuildRow`. That is a server change, which was out of my
   scope — flagging rather than making it.
2. **Install opens `artifacts.buildUrl`, which may not install anything.** The handoff
   specifies it, so that is what I built. But `buildUrl` is the raw `.ipa`, and iOS cannot
   install from a plain `.ipa` URL — it needs an `itms-services://` manifest, which is what the
   expo.dev build page provides. The row already carries `appSlug` and `ownerName`, so the
   proper page URL (`https://expo.dev/accounts/{owner}/projects/{slug}/builds/{id}` — the
   server's own `buildPageUrl` builds it) is one helper away. **I did not substitute it, because
   the handoff was explicit.** Owner call: keep the artifact link, or point Install at the build
   page. My recommendation is the build page.
3. **`Linking` over the now-available `expo-web-browser`.** Consistent with ruling 1 on the
   Providers report, and here it is not merely consistent but correct: an in-app Safari view
   *cannot* hand off to the system installer, so Install must stay `Linking.openURL` whichever
   URL it points at.
4. **Auto-tail seeds once and then leaves the user alone.** On first load of a non-terminal
   build the newest phase is expanded; polling afterwards never re-expands. The alternative —
   always keeping the newest phase open — fights a user who deliberately collapsed it. Cheap to
   change if it reads wrong on device.
5. **No new dependency, and `package.json` / `pnpm-lock.yaml` untouched.** Per the handoff's
   conflict-risk note.

---

## Merge-back safety

Every shared-file change is an insertion; no existing line was modified.

| File | Change | Conflict risk |
|------|--------|---------------|
| `src/RootNavigator.tsx` | 2 imports, 3 param-list lines, 3 `Stack.Screen` lines | Low — same three hunks the Providers merge already resolved cleanly |
| `src/SettingsScreen.tsx` | One new section above `Server` | Low — the Providers row sits directly above; adjacent but non-overlapping |
| `src/colors.ts` | +4 (the `success` token) | Low |
| `package.json` / `pnpm-lock.yaml` | **none** | — |

---

## Files

| Path | Role |
|------|------|
| `packages/agent-console-native/src/builds.ts` | Data layer: defensive fetchers + all pure helpers — 417 lines |
| `packages/agent-console-native/src/BuildsScreen.tsx` | The list, refresh, auto-poll — 277 lines |
| `packages/agent-console-native/src/BuildDetailScreen.tsx` | Metadata, Install, phased log — 466 lines |
| `packages/agent-console-native/src/BuildStatusPill.tsx` | Shared status capsule; the only tone→colour mapping — 79 lines |
| `packages/agent-console-native/src/builds.test.ts` | 44 tests, server-free — 360 lines |
| `packages/agent-console-native/src/SettingsScreen.tsx` | +15 — the Builds row |
| `packages/agent-console-native/src/RootNavigator.tsx` | +9 — `Builds` + `BuildDetail` routes |
| `packages/agent-console-native/src/colors.ts` | +4 — semantic `success` |

---

## Next

1. **Run it against the live backend.** The highest-value check is a real `/builds/:id`
   response: the detail field names came from the handoff, not from a response I read, and any
   that EAS spells differently will simply render as absent rather than erroring — which means
   a missing row is the symptom to look for, not a crash.
2. **Settle open decision 2** (Install target) — it is the one thing that could ship looking
   finished while doing nothing.
3. Take open decision 1 to whoever owns `buildsPlugin.ts` if list timestamps are wanted.
4. Fold into `app/double-agent/ios`.

---

## Session log

**2026-09-09** — Built from [`builds-page-handoff.md`](../builds-page-handoff.md). Read the
server's `buildsPlugin.ts` (`11a5bb4`) rather than working only from the handoff's contract —
that is where the `createdAt` gap (open decision 1), the empty-`phases` case for a queued
build, and the `UNKNOWN`/`XCODE` phase names came from. Three self-review fixes before commit:
the auto-tail seed burned its one chance when the *detail* fetch failed rather than the logs
fetch; `void Linking.openURL(...)` would have left a rejection unhandled so a failed Install
tap looked like nothing happened; and an expanded phase rendered every line, which a real
`RUN_FASTLANE` would have janked. `packages/agent-console-native` is not in the root ESLint
globs, so tsc + vitest are the whole gate.
