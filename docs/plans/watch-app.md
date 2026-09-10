# DoubleAgent for Apple Watch

**Status:** prototype — mockups only, no code, no watchOS target. Captured 2026-09-10.
**Mockups:** [Widget board's companion piece](https://claude.ai/code/artifact/e4fe1e09-bd95-4111-af4b-6c72763139cc)
— five screens at true 45mm size (396 × 484 pt).
**Related:** [chat-surface-and-attachments.md](./chat-surface-and-attachments.md)

## The premise

Built the way Messages is: a list of conversations, a thread you scroll with the Crown, and a
reply bar that assumes you are not going to type. The iOS app's layout survives almost intact —
what changes is what gets cut, and where the system clock forces things to move.

Five screens: **Sessions**, **Session** (thread), **Reply**, **Permission**, **Notification**,
plus the complications strip.

## Three decisions worth arguing with

**Pinning, not re-sorting.** Messages sorts by recency, but this app's value is knowing what is
blocked on you. Rather than invent a new sort, recency stays — it is what the muscle memory
expects — and a waiting session pins to the top. That is a mechanic Messages already has and
users already understand: familiar affordance, correct priority, no new idiom.

**The iOS bubble grammar carries over untouched, and earns more here.** You get a right-aligned
green bubble; the agent gets plain full-bleed text with no bubble at all
(`MessageBubble.tsx`). At 396 pt a bubble would give up a third of every line to padding.

**Dictation gets top billing.** Messages offers four ways in — emoji, dictation, scribble,
keyboard. Two are meaningless to an agent. Talking to a coding agent is the one thing a watch
does genuinely *better* than the phone: no keyboard, no glass, no unlocking. Messages' smart
replies become four fixed ones (Continue / Go ahead / Looks good / Stop), which beats a model
guessing at prose.

## Two constraints that moved things

**Tool calls collapse to one line** — icon, verb, target. The iOS screen offers expandable
blocks with diffs and output; none of that is readable on a watch, and *a diff you cannot read
is worse than no diff, because it looks like you could read it.* Never render one.

**watchOS owns the top-right corner of every screen for the clock.** That corner is not the
app's to spend, so the run timer sits under the title rather than in the header where iOS puts
it. Single biggest layout difference from the phone.

## Reaching the server — resolved

The app talks to opencode over Tailscale (`client.ts`: "always points at a local / Tailscale
opencode server, never a public host"), and there is no Tailscale client for watchOS. That
looks like a wall and is not one.

**While the watch is routed through its paired iPhone, its traffic egresses through the phone's
network stack and takes the phone's tunnel with it.** The tailnet host resolves; the watch talks
to the server directly. That removes an entire layer from the design — no `WatchConnectivity`
proxy, no phone-side request handler, no background-wake round trip. Ordinary `URLSession`
calls against the same base URL, in the same shape as the widget extension's own fetcher.

What remains is a plain dependency rather than an architecture problem: **the watch needs the
phone in range.** On LTE with the phone off or away, the tunnel is not in the path — cellular
does not help, because the constraint was never bandwidth.

## The screen not yet drawn

That dependency shapes exactly one screen: the **disconnected state**. The list shows its last
sync, honestly marked, and the reply affordances go away rather than failing on tap — the same
"show what was true, say that it is old" rule the widget data layer already follows. Worth
drawing before any Swift.

## What building it would take

- A watchOS target (none exists; `targets/` currently holds the widget/Live Activity extension,
  the App Intents extension and the notification service).
- A Swift opencode client — which would be the **fourth** copy of that logic, after
  `SessionActivityAttributes.swift` (duplicated by necessity),
  `targets/app-intents/OpencodeClient.swift` and the widget prototype's `WidgetData.swift`.
  Worth settling whether these targets get a shared file first.
- Notifications forward from the phone for free; the permission-ask category and its two
  actions are mostly a matter of declaring them.
- The three accessory views written for the widget prototype render as watch complications
  unchanged — WidgetKit shares those families between the iPhone lock screen and the watch face.
