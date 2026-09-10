# Siri / App Intents surface — survey for DoubleAgent

A map of every Siri-adjacent extension and API, and where each one is relevant
to DoubleAgent (control your coding agents from the phone, hands-free). Current
as of iOS 26. Two of these are already built; the rest is a prioritized roadmap.

## The two frameworks, and which to use

- **App Intents** (modern, iOS 16+, the strategic one). Pure Swift, no extension
  target: you declare `AppIntent`s and they light up across **Siri / Apple
  Intelligence, Spotlight, Shortcuts, the Action button, Control Center,
  Widgets, and Controls** from one definition. This is where almost all new
  DoubleAgent work should go.
- **SiriKit Intents** (legacy `INIntent`, per-domain extensions). Mostly
  superseded — **except** the Messaging and Calling domains, which App Intents
  still doesn't cover. Communication-notification **reply** is Messaging, so it
  necessarily uses a legacy Intents extension (built below). Don't reach for
  SiriKit for anything else.

## Already built

| Piece | API | Status |
|---|---|---|
| Live Activity Stop button | `LiveActivityIntent` (App Intents) | shipped (`StopAgentIntent`) — now actually reachable, since the app finally writes `serverURL` to the app group |
| "Message from the agent" pushes | Communication Notifications (`INSendMessageIntent` in an NSE) | shipped |
| Hands-free reply → session | SiriKit Messaging (`INSendMessageIntentHandling` Intents extension) | shipped (`targets/intents`) — resolves the session from `conversationIdentifier`, POSTs to `/session/{id}/prompt_async` |

## App Intents — the high-value roadmap

Each of these is a small `AppIntent` (+ an `AppShortcut` phrase). No new
extension target; they run in-process or in the existing widget/app-intent
context. Ordered by value.

1. **Send a prompt / ask the agent** — `AppIntent` with a `prompt: String`
   parameter (+ optional Session). "Hey Siri, ask DoubleAgent to run the tests."
   The single most useful action: start work by voice without opening the app.
   Backs Siri, the Action button, and Shortcuts automations.
2. **Session as an `AppEntity` + `EntityQuery`** — model a session (id, title,
   repo, busy) so every other intent can take "the epsilon session" by name, and
   Spotlight/Siri can reference them. The backbone for the rest.
3. **Run status** — `AppIntent` returning a spoken/snippet result: "DoubleAgent
   is editing SessionChatScreen.tsx in epsilon." Pairs with the Live Activity.
4. **Stop / abort by voice** — a plain `AppIntent` version of the Live Activity
   Stop, so "stop DoubleAgent" works from anywhere, not just the island.
5. **App Shortcuts** (`AppShortcutsProvider`) — zero-setup Siri phrases + auto
   Spotlight entries for 1–4. This is what makes them discoverable without the
   user building a shortcut. Ship alongside each intent.
6. **Control Center / Lock Screen Controls** (`ControlWidget`, iOS 18+) — a
   toggle/button control to start a preset prompt or stop the active run.
7. **Home-screen / StandBy Widget** (WidgetKit + App Intents buttons) — running
   sessions at a glance, with inline Stop; reuses the activity attributes.
8. **Focus Filter** (`SetFocusFilterIntent`) — a "Coding" Focus that scopes
   which sessions notify / which server the app points at. Fits the multi-repo
   workflow.
9. **Spotlight indexing** (`CoreSpotlight` + `IndexedEntity`) — sessions become
   searchable from the home screen; tapping deep-links into the chat.

## Deliberately out of scope (for now)

- **Calling domain** (`INStartCallIntent`) — no calls in the product.
- **Assistant schemas** (`@AssistantIntent(schema:)`, the Apple-Intelligence
  domain protocols: mail, photos, browser, system, …) — there's no "coding
  agent" domain, and forcing our actions into `system`/`messages` schemas buys
  little over plain App Intents + App Shortcuts, which Apple Intelligence already
  reasons over. Revisit only if a fitting domain appears.
- **Intents UI extension** (`INUIAddVoiceShortcutButton`, custom Siri UI) —
  App Shortcuts render fine without custom UI.

## Notes that bit us / worth remembering

- The messaging reply **must** be the legacy Intents extension — App Intents has
  no messaging schema yet (verified iOS 26). Don't try to port it.
- Extensions share nothing with the app: the server address travels via the
  **app group** (`group.com.nikolasstow.agentconsolenative`). Any new extension
  that calls the server reads `serverURL` there — and the app must be writing it
  (it now does, on address change).
- `AppIntentsTesting` (iOS 26) lets us unit-test intents through the real system
  path without UI automation — use it for the roadmap items.

## Sources
- [App Intents — Apple](https://developer.apple.com/documentation/appintents)
- [App intent domains / App schema domains — Apple](https://developer.apple.com/documentation/appintents/app-schema-domains)
- [Bring your app to Siri — WWDC24](https://developer.apple.com/videos/play/wwdc2024/10133/)
- [Build intelligent Siri experiences with App Schemas — WWDC26](https://developer.apple.com/videos/play/wwdc2026/240/)
- [INSendMessageIntentHandling — Apple](https://developer.apple.com/documentation/intents/insendmessageintenthandling)
- [Creating App Intents using Assistant Schemas — createwithswift](https://www.createwithswift.com/creating-app-intents-using-assistant-schemas/)
</content>
