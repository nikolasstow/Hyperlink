# DoubleAgent native: preload before the tap

Owner decisions (2026-10-02), the source of truth for this work.

## Rule

Nothing a page shows loads after the tap that opens it. What someone might
open next is fetched when the app opens or comes back, or when the page that
leads to it opens, and kept on the device. Opening a page renders from the
device; only what is older, or live, loads after.

## Who preloads

The control that opens something preloads it: a session card keeps its
session, a folder row its files. The logic sits in that component (a hook
such as `usePreloadConversation`), not in the page around it, so any list
that shows the control preloads for free.

## Conversations (built)

- Kept: each session's newest messages (`KEPT_MESSAGES`, 30: a screenful and
  more), its protocol (v1 or v2), and the server's last-changed time as of
  keeping them. On the device (KeyValueStore over AsyncStorage, one entry per
  conversation, writes coalesced), read back at launch.
- Preloaded: every session card asks for its own; the 30 most recent
  top-level sessions are asked for when the app opens and on each foreground
  signal (`keepRecent`, an Effect over `DeviceSignals`). A session unchanged since kept is not fetched; one being
  fetched is not fetched twice; three at a time.
- The chat opens on what is kept (no protocol check, no wait). Its whole
  history and live stream load behind it; it switches to them once they are
  in (v1: history loaded; v2: event replay gone quiet). An open chat hands its
  newest messages back as they change; the store coalesces them.
- Code: `src/conversations/` (`Conversations.ts` service, `model.ts` schema,
  `useConversations.ts` React bridge, `usePreloadConversation.ts`,
  `ConversationPreloader.tsx`).

## Files (next)

- The repo's file tree is kept on the device and refreshed when the repo page
  opens, so the Files page is ready when opened.
- On the Files page, opening a folder preloads its most recently viewed
  files; again for every folder opened.
- Big files load in parts, and syntax colouring must hold across the parts.

## Not yet

- Conversations update while the app is open only through an open chat (and
  on the next foreground). An app-wide event subscription feeding the store
  would keep every kept session current live.
