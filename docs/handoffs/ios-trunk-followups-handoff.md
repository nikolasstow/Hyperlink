# Handoff: iOS trunk follow-ups

**For:** the agent on `app/double-agent/ios` (Communication Notifications + Siri +
build notify + hosted previews).
**Branch:** `app/double-agent/ios`, tip `a3bd389e`.
**Source:** an issue sweep run on `a3bd389e` after PR #87 merged. Items that sit in the
prototype branches were kept out; see
[the prototype inventory](./reports/2026-09-20-prototype-issue-inventory.md) for those.

## Before acting on this handoff

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This handoff is not a go.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## State of the trunk, measured

Run on `a3bd389e`, in this workspace:

```text
npx eslint packages/agent-console-native packages/agent-console   0 errors, 1 warning
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx tsc --noEmit -p packages/agent-console/tsconfig.json          exit 0
```

Everything below is either that one warning, a missing field another screen needs, or a
decision only you can make.

## 1. The lint, typecheck and test gates now cover your packages

`198aff04` landed with PR #87 and closed three holes that were silent until then.

| Hole | Before | Now |
|------|--------|-----|
| ESLint | `packages/agent-console-native` matched no `files` glob, so ESLint visited none of it | Both app packages lint under the React ruleset |
| Typecheck | Neither app package appeared in the `hyp typecheck` list | Both are in it; the native package gained a `typecheck` script |
| Tests | Root vitest included `test/**` only, so tests beside package source never ran | Both packages are vitest projects, adding 105 tests to `pnpm test` |

Four files in your area needed edits to pass the first lint run: `App.tsx`,
`SettingsScreen.tsx`, `ToolCallBubble.tsx` and `CodeBlock.tsx`. Those are already fixed on
the trunk. The thing to know is that your next push runs through ESLint for the first time,
so run `npx eslint packages/agent-console-native packages/agent-console` locally before you
push rather than finding out at the gate.

## 2. `/builds` returns no timestamp

`asBuildRow` in `packages/agent-console/src/server/buildsPlugin.ts:56` builds the row the
`/builds` endpoint serves. It carries `id`, `status`, `platform`, `buildProfile`,
`appVersion`, `gitCommitMessage`, `artifacts.buildUrl` and `app`, and nothing that says when
the build happened. The Builds screen on `app/double-agent/builds` therefore renders rows
with no date, which makes a list of twenty builds hard to read.

`eas build:list --json` does carry build timestamps. Confirm the exact key against a live
run before adding it, rather than trusting this sentence: the payload has changed shape
between eas-cli versions. Add it to the `BuildRow` type, map it in `asBuildRow` the same way
the other optional strings are mapped, and record it in
[`builds-page-handoff.md`](./builds-page-handoff.md) so the published contract and the code
agree.

Two lines of work, in your file. Say the word if you would rather it came as a patch from
the prototype side.

## 3. `HomeTargetPickers.tsx:169`

The only warning left in either app package:

```text
169:6  warning  React Hook React.useEffect has a missing dependency: 'props'.
       react-hooks/exhaustive-deps
```

The effect at `packages/agent-console-native/src/HomeTargetPickers.tsx:151` defaults the
target to the first known repo once the scan lands. It reads `props.target` and calls
`props.onChange`, and the rule cannot see that the deps array covers them, so it asks for
`props` itself. Adding `props` is the wrong fix, because the effect would then re-run on
every parent render and re-default the target. Destructuring `target` and `onChange` above
the effect and depending on those two names is what the rule is asking for and keeps the
current behaviour.

This is your screen and the fix changes what the effect depends on, so it was left alone
rather than guessed at from outside.

## 4. Twelve `exhaustive-deps` suppressions, one decision

Both app packages carry `eslint-disable` comments for `react-hooks/exhaustive-deps`:

| File | Lines |
|------|-------|
| `agent-console-native/src/NewRepoSheet.tsx` | 221, 344, 362 |
| `agent-console-native/src/Composer.tsx` | 271, 277 |
| `agent-console-native/src/AppearanceScreen.tsx` | 210 |
| `agent-console-native/src/SessionChatScreen.tsx` | 329 |
| `agent-console-native/src/HomeTargetPickers.tsx` | 184 |
| `agent-console-native/src/CodeBlock.tsx` | 43 |
| `agent-console/src/components/NewSessionPicker.tsx` | 82 |
| `agent-console/src/opencode/useSessionDetails.ts` | 185 |
| `agent-console/src/pages/RepoSessions.tsx` | 72 |

`no-suppression-comments` in [`docs/standards/no-backward-compat.md`](../standards/no-backward-compat.md)
scopes itself to `src examples`, meaning the library, so none of these breaks a locked rule.
Five of them carry a reason on the line, which is the shape that standard asks for when a
suppression is unavoidable. Four carry none: `NewRepoSheet.tsx` at 221, 344 and 362, and
`SessionChatScreen.tsx` at 329.

The decision is whether the app packages adopt the library's bar. If they do, the four bare
ones need a reason or a real fix. If they do not, say so once in
[`agent-status.md`](./agent-status.md) so the next sweep does not raise it again.

## 5. Still yours from the status board

Unchanged by this sweep, listed so the picture is complete: the on-device rebuild your row
depends on, covering comm-notification styling, hands-free voice reply, the Stop-button fix,
and the Safari-view preview.

One stale entry worth knowing about: the board's **Providers UI** row says the branch merged
into `app/double-agent/ios`. The owner reverted that merge, and the trunk carries no
providers code. That row belongs to the prototype side and is being corrected there.

## Acceptance bar

- `npx eslint packages/agent-console-native packages/agent-console` reports zero problems,
  warning included.
- Both app `tsc --noEmit` runs stay at exit 0.
- `npx vitest run` stays green, 1161 passing at the time of writing.
- If `/builds` gains a timestamp, `builds-page-handoff.md` names it.

## Not in this handoff

These sit in prototype branches and belong to the prototype agent. They are named here only
so the same issue is not worked twice: the theme editor follow-ups on the trunk, the Builds
screen itself, the widget prototype, and the toolkit type errors that keep `pnpm verify`
red.
