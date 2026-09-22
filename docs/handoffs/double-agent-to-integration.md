# DoubleAgent → integration: DONE (2026-09-22)

`app/double-agent/ios` was merged to `integration`. Both are now `c1859fca6`.
This file is the closing record; the earlier version's plan was built on a wrong
premise (see the correction below) and no longer applies.

## Premise correction

The earlier handoff claimed `app/double-agent/ios` had **no common ancestor** with
`integration`/`main` and that any merge would be an unrelated-histories add/add
storm. That was wrong. The branches **share history** (merge-base `2b7c8144`,
2026-08-15) and shared roots. `git merge-base` returns a real commit; no
`--allow-unrelated-histories` was involved. Of the ~140 shared files that
differed, only `src/internal/address.ts` had changed on both sides, and it
3-way-merged cleanly.

## How it landed

1. The Monaco code-surface stack merged onto ios first: **#92 → #93 → #94**
   (verified locally; a stacked-merge retarget hiccup was recovered by retargeting
   #94, which carried the whole stack, onto ios).
2. `integration` was merged **into** `app/double-agent/ios` — clean 3-way, 0
   conflicts; `address.ts` auto-merged with integration's dial-identity fix intact
   (its 11 tests pass).
3. `integration` was **fast-forwarded** to ios (`8c9184c4a → c1859fca6`) — a true
   FF, no force. Integration == ios, no separate merge commit.

Verification was **local only** — GitHub Actions is failing account-wide
(billing/quota; every run dies with zero steps), so CI could not gate this. The
app package is `tsc`-clean, `eslint` 0, **114 tests pass**. The native Swift
(`code-surface` module) is uncompiled until an EAS build ships (WebView fallback
on the current binary). `pnpm verify` (full toolkit) remains red on both branches
for pre-existing reasons (#88 territory) — not introduced by this merge.

## PR housekeeping

Merged: #92, #93, #94, #96. Closed: #89 (superseded), #81 (wrong target/scope).
Merged stack branches deleted.

## Still open (deferred, not blocking)

- **#95** (macOS CI to compile the Swift) — can't go green until GitHub Actions
  billing/quota is restored.
- **#88** (toolkit typecheck), **#82** (Builds screen — `.ipa` install bug),
  **#83** (WidgetKit prototype, uncompiled Swift) — separate decisions.
