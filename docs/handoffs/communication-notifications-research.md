# Communication Notifications — research & implementation plan

Goal: make DoubleAgent's push notifications register as **messages from the
agent** (iOS Communication Notifications), so Siri's *Announce Notifications*
reads "Message from <session> …" over AirPods/CarPlay and lets you dictate a
reply hands-free. The reply itself already works; this is the layer that turns a
generic alert into a Siri-readable conversation.

## What already exists (don't rebuild)

The reply plumbing is complete and shipped:

- Server tags the idle + permission pushes with `categoryId: "agent"`
  (`packages/agent-console/src/server/notificationsPlugin.ts`).
- App registers the `"agent"` category with a **"Reply"** text-input action,
  `opensAppToForeground: false` (`packages/agent-console-native/src/push.ts`,
  `registerReplyCategory`).
- App's response listener parses the reply and sends it as a prompt:
  `client.session.promptAsync(...)` (`src/RootNavigator.tsx`), with cold-launch
  replay via `getLastNotificationResponseAsync`.

Communication Notifications **feed into this same reply action** — they don't
replace it. Announce reads the message, offers "Reply", the dictated text lands
in the existing text-input action → `promptAsync`.

## The API

Communication Notifications (iOS 15+). On the device, when a push arrives you
attach an `INSendMessageIntent` describing the sender (an `INPerson`) and call
`content.updating(from: intent)`. iOS then renders the notification in the
"message" style (avatar, sender name) and — critically — treats it as a
communication, which is what makes Announce read it as "Message from X" and
enables hands-free reply.

The intent **must be attached on-device** — you cannot send an
`INSendMessageIntent` through APNs. For push notifications this means a
**Notification Service Extension (NSE)** that intercepts each push before display
and rewrites its content.

### Flow

```
server push (mutable-content:1, sender fields)
  → NSE.didReceive (on device)
      build INPerson(sender) + INSendMessageIntent(conversationIdentifier: sessionID)
      donate INInteraction(.incoming)
      content = try content.updating(from: intent)
      contentHandler(content)   // now a communication notification
  → iOS shows "message from <agent>"; Announce reads it; Reply action → promptAsync
```

## Requirements checklist

### Main app target
- **Capability:** "Communication Notifications" →
  `com.apple.developer.usernotifications.communication: true` in
  `app.json > ios.entitlements`. **Self-serve** (toggled in Xcode / registered on
  the App ID automatically) — this is NOT the `com.apple.developer.usernotifications.filtering`
  entitlement, which is the special-request one for *suppressing* notifications
  and is **not needed** here.
- **Info.plist:** `NSUserActivityTypes = ["INSendMessageIntent"]`.
- Push Notifications + Background Modes (remote notifications) — already present.

### Notification Service Extension (new target)
- Extension point `com.apple.usernotifications.service` (apple-targets handles).
- Link `UserNotifications` + `Intents` frameworks.
- Share the existing app group `group.com.nikolasstow.agentconsolenative` (to
  read server address / cached avatar, same as the activity widget does).
- `NotificationService.swift`: build `INPerson` (name = session title / repo;
  optional `INImage` avatar), `INSendMessageIntent` with
  `conversationIdentifier: sessionID` (threads replies), donate
  `INInteraction(direction: .incoming)`, then `content.updating(from: intent)`.

### Push payload (server change)
- `aps.mutable-content: 1` — **required** to trigger the NSE.
- New data fields the NSE reads to build the intent: `senderName`
  (session title / repo), `senderId` (sessionID), optional `avatarUrl`.
- Keep existing `categoryId: "agent"` + `data.kind/sessionID` untouched.

## Expo path — lands on infrastructure we already use

The app already uses **`@bacons/apple-targets`** for the Live Activity widget
(`targets/activity/`), and already declares the app group. apple-targets has a
first-class **`notification-service`** target type
(`TARGET_REGISTRY["notification-service"]`, extension point
`com.apple.usernotifications.service`). So the NSE drops in exactly like the
widget did:

```
targets/notification-service/
  expo-target.config.js   // { type: "notification-service",
                          //   frameworks: ["UserNotifications", "Intents"],
                          //   entitlements/app group mirrored from app.json }
  NotificationService.swift
  Info.plist
```

`expo-notifications` (v57) does **not** support NSEs or communication
notifications (confirmed against the v57 docs) — it only covers the JS-level
category/text-input reply, which we already use. So the NSE + intent is
necessarily native, via the apple-targets target above. No third-party NSE
plugin (`expo-nse-plugin`, notifee) is needed — apple-targets is the route we're
already on.

## Siri Announce behavior (what the user gets, and limits)

- Announce Notifications is a **user setting** (Settings ▸ Notifications ▸
  Announce Notifications), on by default for AirPods/CarPlay/some CarPlay-like
  contexts. We can't force it on; a communication notification just makes it
  *eligible* to be read and replied to hands-free.
- Communication notifications get priority for Announce and for Focus
  breakthrough, so this also improves delivery while a Focus is on.
- Hands-free reply funnels through the existing `"agent"` text-input action, so
  no new reply wiring.

## Delivery constraints (flag before starting)

- Native + a new capability + a new target → **cannot be HMR'd**. Needs a
  rebuild and a credentials/provisioning refresh (EAS picks up the new
  entitlement once the App ID has the capability).
- The `.communication` capability is self-serve, but must be enabled on the App
  ID before a signed build will carry it — confirm when we flip it.
- The avatar (`INImage`) is optional; a generic monogram/app glyph is fine for
  v1. A per-repo avatar would need the NSE to fetch/cache via the app group.

## Open decisions

1. **Scope:** idle notifications only, or permission ("waiting for approval")
   pushes too? Both already carry `categoryId: "agent"`; making both
   communication is a one-line NSE branch.
2. **Sender identity:** session title alone, or "repo · title"? Affects what
   Announce reads aloud.
3. **Avatar:** ship without (monogram) for v1, or wire per-repo avatars through
   the app group now?
4. **conversationIdentifier = sessionID** — confirms reply threading; no
   decision needed unless we want per-repo grouping instead.

## Sources

- [Implementing communication notifications — Apple](https://developer.apple.com/documentation/usernotifications/implementing-communication-notifications)
- [com.apple.developer.usernotifications.communication — Apple](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.communication)
- [Send communication and Time Sensitive notifications — WWDC21](https://developer.apple.com/videos/play/wwdc2021/10091/)
- [Stay Connected: Mastering iOS Communication Notifications — A. Gruchała](https://arturgruchala.com/stay-connected-mastering-ios-notifications-for-seamless-communication/)
- [Communication Notifications — Smartsupp iOS SDK](https://docs.smartsupp.com/mobile-sdk/ios/communication-notifications/)
- [iOS Communication Notifications for React Native — C. Mathews](https://medium.com/@christopher.mathews/ios-communication-notifications-for-react-native-with-onesignal-35c83e75e24f)
- [@bacons/apple-targets](https://github.com/EvanBacon/expo-apple-targets) — `notification-service` target type
</content>
</invoke>
