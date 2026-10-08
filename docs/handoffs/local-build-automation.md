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

## Decision (2026-10-08)

EAS for now (it works; native changes are rare since JS rides Metro). Set up
local builds **the weekend of 2026-10-11/12**. The patch route is OFF the table —
`RuntimeScheduler` carries an atomic refcount, so dropping `SWIFT_RETURNS_RETAINED`
risks a double-free, and a `pnpm patch` would ride into EAS/production too. The
safe route is matching EAS's Xcode locally. Confirmed this weekend needs two
one-time manual gates (not automatable): `sudo` (admin password — `sudo -n`
fails) and an Apple ID for `xcodes` to download Xcode. Disk is fine (1.4 TB free).

## Weekend runbook

1. **Find EAS's Xcode.** The build JSON doesn't carry it and the logs are an
   opaque binary encoding. Read it off the EAS dashboard build page ("Image"
   field, human-readable), e.g.
   `https://expo.dev/accounts/nikolasstow/projects/agent-console-native/builds/<id>`.
   If unavailable, go empirically: the failing local Xcode is 26.3 (Swift
   6.2.4); try **26.2** first (the local SDK is already 26.2), then 26.1, then
   16.4 — stop at the first that compiles the unmodified `expo-modules-jsi`
   header.
2. **Install it** (owner runs, via the `!` prompt so creds stay in-session):
   `! xcodes install <version> --experimental-unxip` (prompts Apple ID), then
   `! sudo xcode-select -s /Applications/Xcode-<version>.app` (admin password).
   Keep 26.3 installed; just point `xcode-select` at the older one for builds.
3. **Compile check:** `xcodebuild -project ios/Pods/Pods.xcodeproj -target
   CodeEditor -sdk iphonesimulator -arch arm64 ONLY_ACTIVE_ARCH=YES
   SYMROOT=/tmp/ce build` — the `RuntimeScheduler.h` error must be gone. (This is
   the same probe that failed on 26.3.)
3. **Build the `.ipa`:** `eas build --local -p ios --profile development
   --non-interactive --output /tmp/agent-console-native-dev.ipa` (uses the stored
   cert + ad-hoc profile; no cloud compute, no credits).
4. **Distribute OTA:** generate an `itms-services` manifest `.plist` pointing at
   the hosted `.ipa`, serve both from a Tailscale-reachable path (a small route
   on the `:5195` DoubleAgent server is simplest), push
   `itms-services://?action=download-manifest&url=<manifest>` to the phone via
   notify-phone.
5. **Wrap as `pnpm build:local`** (new `scripts/build-local.ts`): run steps 3–4,
   push the install link on success, push the error on failure — same no-touch
   contract as the cloud path, but free.

## Status

- [x] Short-term: EAS `development` builds shipping + install links delivered
      (builds #1 crashed on `onChange`; #2 fixed, apiVersion 2).
- [x] Root-caused the local blocker: Xcode 26.3 strictness, not our code.
- [ ] (weekend) Confirm EAS Xcode, install matching Xcode (owner: Apple ID + sudo).
- [ ] (weekend) `eas build --local` end-to-end → signed `.ipa`.
- [ ] (weekend) Self-hosted `.ipa` + `itms-services` manifest + phone push.
- [ ] (weekend) `pnpm build:local`.
