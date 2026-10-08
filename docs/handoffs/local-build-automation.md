# Local iOS build automation (agent-console-native)

Goal: build the dev client **on this machine** instead of EAS cloud, fully
automated, so routine native rebuilds cost no EAS credits and need no human at
the computer. The owner installs over-the-air on his phone (no cable, no
VNC/SSH); his device is already a provisioned ad-hoc device.

## Why EAS is the short-term path (today)

A full local compile is blocked by TWO things, both real:

1. **Upstream compile bug.** `expo-modules-jsi@57.0.5`'s
   `ExpoModulesJSI-Cxx/include/RuntimeScheduler.h` annotates its *constructors*
   with `SWIFT_RETURNS_RETAINED`, which Swift 6.2 (Xcode 26.3, the only Xcode on
   this box) rejects: *"cannot be annotated … because it is not returning a
   SWIFT_SHARED_REFERENCE type."* The dependency builds from source in the graph
   and dies before our module compiles. EAS's image uses a toolchain where this
   passes, which is why cloud builds work.
2. **Device signing + distribution.** A local *device* build must codesign and
   then be delivered to the phone. EAS manages the distribution cert +
   ad-hoc profile (device UDID `00008130-000C4D822461401C` is registered) and
   serves an install URL. Locally we'd have to reproduce both.

So: `pnpm build:dev` (EAS, `development` profile, internal distribution) remains
the one-command path. One build, then all JS/theme/editor iteration rides Metro
(see below) — no rebuild until the next *native* change.

## What makes local viable (`eas build --local`)

`eas-cli` 24.12 supports `eas build --local -p ios --profile development`: it runs
the EAS build **on this machine** using the same stored credentials (cert +
profile), emitting a signed `.ipa` — no cloud compute, no credits. Ruby 4.0.6 is
present (fastlane-capable). This is the spine of the automation. It needs the two
blockers above solved:

### 1. Patch the jsi bug durably (`pnpm patch`)

The fix is to drop `SWIFT_RETURNS_RETAINED` from the two `RuntimeScheduler(...)`
constructors (lines ~53, ~61). Do it the sanctioned way, not by hand-editing
`node_modules`:

```
pnpm patch expo-modules-jsi@57.0.5
# edit the copy: remove "SWIFT_RETURNS_RETAINED " before each "RuntimeScheduler("
pnpm patch-commit <dir>   # writes patches/ + patchedDependencies in package.json
```

OPEN QUESTION before committing the patch repo-wide: is removing the annotation
runtime-safe, or does it change ownership for Swift callers of those
constructors? The annotation on a *constructor* is suspect (Swift owns
construction), so removal is likely a no-op — but verify against a local run
before relying on it, and confirm it doesn't regress the EAS build (EAS would
pick up the patch too). If risky, prefer a scoped workaround: an APINotes entry
or a per-target `-Xcc` flag that disables the C++-interop check for that header
only, leaving the source untouched.

### 2. Distribution without cable

`eas build --local` yields a signed `.ipa`. To get it on the phone OTA:
- Host the `.ipa` + a generated `itms-services` manifest `.plist` on a
  Tailscale-reachable static path (the DoubleAgent server on `:5195`, or a tiny
  route), and push the `itms-services://?action=download-manifest&url=…` link to
  his phone via the notify-phone skill.
- Alternative: `eas build --local` then `eas submit`/internal-distribution upload
  — but that re-involves EAS. The self-hosted manifest keeps it fully local.

## Target: one script, zero touch

`pnpm build:local` (new) that: runs `eas build --local` → finds the `.ipa` →
writes the manifest → serves both → pushes the install link to the phone. On
failure, pushes the error. Same no-touch contract as the cloud path, but free.

## Metro is the real credit-saver already

The `development` build is a dev client: it loads JS from Metro
(`:8081`, this worktree, reachable at Tailscale `100.67.32.32`). Every non-native
change — editor behaviour, `editable`, highlighting, theme, new screens, the
`/fs/write` save path — ships by Metro reload, no rebuild. A native rebuild is
only for Swift/native-module changes. Keep Metro alive in tmux so the installed
app always has a server.

## Status

- [x] Short-term: EAS `development` build shipped + install link delivered.
- [ ] `pnpm patch` the jsi header (answer the runtime-safety question first).
- [ ] Prove `eas build --local` compiles end-to-end with the patch.
- [ ] Self-hosted `.ipa` + `itms-services` manifest + phone push.
- [ ] Wrap as `pnpm build:local`.
