# Handoff: merging DoubleAgent, and the branch that has no ancestor

**For:** the agent merging the open pull requests and taking `app/double-agent/ios` to
`integration`.
**Measured on:** `app/double-agent/ios` at `eeb04fdc`, `integration` at `8c9184c4`.

Read the first section before planning anything. It changes what "merge to integration" means.

## Before acting on this handoff

1. **Confirm before acting.** List the concrete actions you will take and wait for owner
   confirmation before changing code. This handoff is not a go, and the second half of it
   describes an operation that can silently lose a month of work.
2. **Review standards.** Read `docs/standards/` if you have not recently, at least Agent Rules,
   Principles, and the chapters touching your work. Nothing here overrides a locked standard.

## `app/double-agent/ios` has no common ancestor with `integration`

```text
git merge-base origin/integration origin/app/double-agent/ios   → nothing
git merge-base origin/main        origin/app/double-agent/ios   → nothing
git merge-base origin/main        origin/integration            → acbf3ac2
```

`main` and `integration` are one history. `app/double-agent/ios` is a separate one: 234
commits with a root commit of its own, dated 2026-09-04, carrying a full copy of the
repository.

An ordinary merge refuses outright. `--allow-unrelated-histories` accepts it, and because git
has no base to compare against, **every file that differs becomes an add/add conflict with no
common version to merge from**. Nothing is auto-resolved on those files, and a careless
resolution reverts whichever side it did not pick.

## What the two trees actually hold

| | count |
|---|---|
| Files on `integration` | 1645 |
| Files on `app/double-agent/ios` | 1916 |
| In both | 1641 |
| Only on ios | 275 |
| **Only on integration** | **4** |
| Of the shared files, differing | **143** |

The 275 ios-only files are the DoubleAgent app and its docs, and they carry no conflict: there
is nothing on the other side to disagree with.

The four files only on `integration`:

```text
.cursor/rules/code-formatting.mdc
docs/handoffs/agent-06-note-to-agent-l-context-reference.md
docs/handoffs/agent-06-service-make-and-address-requirement.md
docs/handoffs/verify-red-2026-08-21.md
```

The 143 that differ, by area:

| Area | Files |
|------|------:|
| `packages/last-ts` | 36 |
| `src/internal` | 22 |
| `test` | 20 |
| `docs/last` | 17 |
| `docs/site` | 8 |
| `examples` | 7 |
| `src/ui` | 6 |
| `src/web` | 5 |
| everything else | 22 |

Regenerate that list rather than trusting this one, because both branches move:

```sh
git fetch origin integration app/double-agent/ios
comm -12 \
  <(git ls-tree -r --name-only origin/integration | sort) \
  <(git ls-tree -r --name-only origin/app/double-agent/ios | sort) \
| while read -r f; do
    [ "$(git rev-parse origin/integration:"$f")" != "$(git rev-parse origin/app/double-agent/ios:"$f")" ] && echo "$f"
  done
```

## The question this handoff cannot answer for you

Every divergent file sampled is **newer on ios**:

| File | integration | ios |
|------|-------------|-----|
| `packages/last-ts/src/internal/lastLink.tsx` | 2026-08-14 | 2026-09-04 |
| `src/internal/fileRouterPaths.ts` | 2026-08-02 | 2026-09-04 |
| `test/document-provide.test-d.ts` | 2026-08-10 | 2026-09-21 |
| `eslint.config.mjs` | 2026-08-10 | 2026-09-20 |
| `vitest.config.ts` | 2026-08-03 | 2026-09-20 |

`integration` has not moved since 2026-08-24. That makes "ios is the newer line" the
tempting reading, and it is the one to be careful about, because of this:

**Of the 143 divergent files, only 3 matched `integration`'s tip at ios's root commit, and
none matched `main`'s.** So ios was not snapshotted from either branch's tip. It started from
some other state on 2026-09-04, already differing from both, and where that state came from is
not recoverable from the graph.

The consequence: a wholesale `-X theirs` toward ios could revert `integration` work that ios's
snapshot never contained, and a wholesale `-X ours` could revert a month of DoubleAgent work.
**Neither side is safely the winner across all 143.** The toolkit areas, `packages/last-ts`,
`src/internal` and `test`, are where the risk is concentrated; they are also where nothing in
the DoubleAgent app needed changes, which makes `integration`'s version the likelier keeper
there.

Ask the owner where the 2026-09-04 snapshot came from before resolving anything in those
three areas. If the answer is lost, diffing the 65 files in them individually is the only
honest route.

## The open pull requests

All of them target `app/double-agent/ios` or a branch of it, so all of them land before any
integration work starts.

### Merge first

| PR | Branch | Why first |
|----|--------|-----------|
| [#95](https://github.com/nikolasstow/Hyperlink/pull/95) | `ci/ios-build` | Nothing in this repository has ever compiled Swift. `verify.yml` is `ubuntu-latest` only, and triggers only on `integration` and `cursor/**`, so no DoubleAgent branch has been gated by anything. #95 adds a macOS simulator build, which is what would catch the Swift in #94 and in #83. |

### The code surface, stacked

Each is based on the one before, so the diffs do not overlap. Merge in order; each retargets
itself as its parent lands.

| PR | Branch | Base |
|----|--------|------|
| [#92](https://github.com/nikolasstow/Hyperlink/pull/92) | `fix/code-surface-full-editor` | `app/double-agent/ios` |
| [#93](https://github.com/nikolasstow/Hyperlink/pull/93) | `feat/code-surface-documents` | `fix/code-surface-full-editor` |
| [#94](https://github.com/nikolasstow/Hyperlink/pull/94) | `feat/code-surface-native-host` | `feat/code-surface-documents` |

**#94 contains Swift that has never been compiled**, because the environment it was written in
has no Swift toolchain. Two bugs in it were already found by reading rather than building
(`WKWebView.configuration` being `@NSCopying`, and a content controller retaining its handler
into a cycle). Merge #95 first so #94 is compiled on its way in. #94 also needs an EAS build to
do anything; until then the app falls back to the existing WebView host, so merging it changes
no behaviour on the current binary.

### Decide, do not merge blind

| PR | Branch | State |
|----|--------|-------|
| [#89](https://github.com/nikolasstow/Hyperlink/pull/89) | `fix/theme-editor-followups` | **Superseded. Close it.** The owner shipped the colour-key catalog and the long-press duplicate independently; what remained was reopened as #91 and merged. It conflicts across seven files and its base is three weeks stale. |
| [#88](https://github.com/nikolasstow/Hyperlink/pull/88) | `fix/toolkit-typecheck` | **Partly superseded.** The owner took the `@ts-expect-error` fix directly (`455e5889`). The other two parts are still live on ios: the `examples/ui/file-router/api.ts:78` cast and five `TS28` diagnostics in `packages/last-ts/src/internal`. Note this PR touches `packages/last-ts`, which is one of the 143 divergent areas; whether it should land on ios or wait for the integration reconciliation is a real question. |
| [#82](https://github.com/nikolasstow/Hyperlink/pull/82) | `app/double-agent/builds` | Open since 2026-09-10, base three weeks stale. Its Install button opens a raw `.ipa`, which iOS cannot install from; the EAS build page URL is derivable from fields `/builds` already returns. Do not merge before that is fixed or the button is removed. |
| [#83](https://github.com/nikolasstow/Hyperlink/pull/83) | `app/double-agent/widgets` | Open since 2026-09-10. The Swift has never been compiled, and `OpencodeClient.swift` is a third copy of the same file across app, widget and watch targets. #95 would compile it for the first time. Read it as a design, not as working code. |
| [#81](https://github.com/nikolasstow/Hyperlink/pull/81) | `app/double-agent/ios` → `main` | Titled for a `PolicyBuilder` refactor but its head is the whole ios branch, so it proposes the unrelated-histories merge described above, into `main` rather than `integration`. Retarget it or close it; do not merge it as it stands. |

## Suggested order

1. #95, so the rest compile.
2. #92, #93, #94 in that order.
3. Close #89.
4. Decide #88, #82, #83 individually.
5. Retarget or close #81.
6. Only then open the `integration` question, with the owner, starting from where the
   2026-09-04 snapshot came from.

## State of the ios branch as it stands

```text
npx tsc --noEmit -p packages/agent-console-native/tsconfig.json   exit 0
npx eslint . --ignore-pattern "repos/**"                          0 errors, 1 warning
npx vitest run                                                    green
```

The warning is `react-hooks/exhaustive-deps` at `HomeTargetPickers.tsx:169` and predates all of
this. `pnpm verify` is red on ios for the toolkit reasons #88 addresses, and red on
`integration` for many more: 133 errors there against 8 on ios when last measured.
