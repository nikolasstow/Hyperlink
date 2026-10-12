# Live file sync: agent edits in an open file

Decisions doc and source of truth for keeping a file current in DoubleAgent
(`packages/agent-console-native`) while someone has it open and is editing it.
Read this before building any part of it; update it when a decision changes.

## Before acting on this doc

List the concrete actions you will take and wait for owner confirmation. This
doc is not a go (`confirm-handoff-actions` in `docs/standards/working-agreement.md`).

## The problem today

- The app saves with `POST /fs/write` (vite backend, `filesPlugin.ts`): a whole-file
  overwrite with no version check. If an agent writes a file while it is open in
  the app, the next autosave puts the old text back. The agent's change is lost
  and nobody is told.
- The native editor (`modules/code-editor`, Runestone) takes text only as a whole
  `text` prop and reports edits only as a whole `onTextChange { text }`. Setting
  new text from outside resets the cursor, scroll and undo.
- opencode sends `file.edited` (its edit/write tools, with the session) and
  `file.watcher.updated` on `/global/event`, but those only cover opencode, and
  the app ignores them. Edits from Cursor, vim or git are invisible.

## Decisions (owner, 2026-10-12)

1. **Agent edits come first.** Most outside edits will come from agents writing
   whole files in single, separate writes. Phase 1 is "an agent changes a file I
   have open and I see it, without losing my edits". Live typing between app
   instances comes after it, on the same protocol.
2. **Live typing between instances: yes** (phase 2). Typing on one device shows
   up on the others within a fraction of a second, not on the autosave timing.
3. **Overlap: the agent wins on disk.** When the user and an agent change the
   same lines, the agent's text is what's on disk. The user's conflicting change
   stays in the editor as an inline conflict (keep mine / keep theirs). It is
   never silently dropped and never written over the agent's.
4. **The server owns each file's version and puts every change in order**
   (Google Docs' central-server model, not a CRDT). Agents write outside any
   CRDT, so their writes would need the same diff step anyway, and a server is
   always in the loop.

## Design

### Server: `FileHub` on the Effect API server (:5199)

New code goes on the off-vite Effect server (`packages/agent-console/src/server/serve.ts`),
which the app already reaches (`settings.ts`, `DEFAULT_API_PORT`). Not on the vite
plugin.

- **Follow.** A client follows a set of paths. The hub keeps, per followed path,
  `{ version, text }` plus a short history of recent changes (for rebasing late
  writes). Paths stay followed while at least one client follows them.
- **Watch.** Platform `FileSystem.watch` on each followed file's **parent
  directory**, filtered to the file. Watching the directory survives
  write-to-temp-then-rename saves, which replace the file's inode.
- **Diff on change.** When the file changes on disk and its text differs from
  the hub's, diff old against new into `changes` (ranges in UTF-16 offsets,
  which JS strings and Runestone's `NSString` both use), bump the version, and
  send `{ path, version, changes, author }` to every follower.
- **Author.** The hub listens to opencode's `/global/event`. `file.edited` has
  no session, so the session comes from the tool call: a `message.part.updated`
  tool part (edit/write) naming the file, running or just finished. Either one
  makes the disk change `Agent { sessionID? }`; anything else is `External`.
  The watcher settles for 150ms before reading, so the event and the agent's
  formatter pass usually land first.
- **Write.** A client sends `{ path, clientID, epoch, baseVersion, changes }`.
  The hub first takes in whatever is on disk (a write the watcher has not
  reported yet), then compares: the base is the current version → apply, write
  to disk, bump, send the change (`Client { clientID }`) to every follower,
  answer `Accepted`. Anything else → `Stale`, nothing written. The hub never
  transforms a write; the client already has every change it missed (from the
  follow stream), rebases on it, and writes again. So the hub keeps no history.
  Its own disk write coming back through the watcher is no change (the text
  matches).
- **Transport.** Effect RPC over a WebSocket (`effect/unstable/rpc` +
  `effect/unstable/socket`). The browser dashboard already requires WebSocket,
  and RN has a native one. Group `FileSync`: `follow(paths) → Stream<FileEvent>`
  and `write(...)`. Schemas are `_tag` unions, one Struct per payload.
- **Diffing.** A small dependency (`fast-diff`, also used by Quill, pure JS)
  rather than a hand-rolled Myers diff. Used on the server for disk changes and
  on the client for phase 1 local edits.

### App: `FileSync` service

- One Effect service over one WebSocket. It follows **every open tab and every
  Keep On Device file**, not just the one on screen, so a file an agent changed
  in the background is already current when tapped (preload before tap).
- The device store keeps `{ version, baseText }` per file next to the existing
  text cache (`fileTextCache.ts`) and the pending edits (`fileEdits.ts`).
- **Incoming change, no local edits:** apply it to the editor.
- **Incoming change with local edits:** shift the pending local changes over the
  incoming ones. Non-overlapping changes merge. Overlapping ones are a conflict
  (decision 3).
- **Saving:** autosave sends `{ baseVersion, changes }` instead of the whole
  text. The blue (device) / green (disk) save light keeps its meaning. A green
  flash means the hub accepted the write and put it on disk.
- **Offline:** edits made offline reconnect with an old `baseVersion`. Merge
  three ways (base, mine, current) and send the result. Overlaps follow
  decision 3.
- The app stops using `/fs/write`. It is deleted from `filesPlugin.ts` and
  `fsClient.ts` in the same change, after checking the web app doesn't need it
  (no shims).

### Native editor (`modules/code-editor`)

- `applyChanges(changes)`: replace ranges in place through Runestone, keeping the
  selection and the lines on screen. The undo stack is cleared on an outside
  change: its steps point at offsets that no longer hold the same text, and
  undoing one would edit the wrong place. (Keeping undo across an outside
  change means transforming the stack; not in phase 1.)
- A brief highlight on lines an agent changed, with "edited by ‹session›" that
  can open the session.
- Conflict marks: the overlapping range shown inline with keep mine / keep
  theirs.
- Phase 2: `onTextChange` reports ranges (`{ range, text }`) instead of the
  whole text, so keystrokes go straight out as changes with no diff.
- Native Swift changes need an EAS build to reach the device.

## Phases

1. **Agent edits** (priority). FileHub (follow, watch, diff, author, versioned
   write over RPC/WebSocket); app FileSync (follow open tabs + kept files, apply
   or rebase, versioned autosave); editor `applyChanges`, agent highlight, conflict
   marks; delete `/fs/write`. Done when: an agent edits a file open on the phone,
   the change appears in place with the cursor where it was, typing elsewhere
   in the file survives, an overlapping edit shows a conflict, and nothing is
   lost on either side.
2. **Live typing between instances.** Editor range events; send changes on a
   short timer (about 200ms) instead of the autosave timing; remote cursors are
   out of scope unless asked for.
3. **Other outside edits** (Cursor, vim, git checkout). Already covered by the
   watcher from phase 1, labelled `External`. This phase only adds whatever
   attribution or UI turns out to matter.

## Built (phase 1, branch `feat/live-file-sync`)

- `packages/file-sync` (shared): `TextChange` (change sets, diff, position
  mapping), `Rebase` (line-level rebase, conflicts), `FileSync` (the RPC group).
- Server: `packages/agent-console/src/server/files/hub.ts` (`FileHub`) and
  `files/rpc.ts` (the WebSocket route), mounted in `serve.ts`. `/fs/write` is
  deleted.
- App: `src/files/liveFile.ts` (pure fold), `LiveFiles.ts` (the service),
  `useLiveFiles.ts` (React bridge + `LiveFilesFollower`), `ConflictBar.tsx`,
  `FileView`/`CodeEditor` wired to it. Native `code-editor` apiVersion 5
  (`applyChanges`, `conflictRangesJson`); older builds get the whole new text.
- Tests: rebase (incl. randomized), hub (real watcher, stale writes, agent
  attribution, rename-saves), the fold, and the app service against a real hub
  over a WebSocket.
- One server: the app's setup asks for the agent-console API server, not
  opencode. The server forwards opencode under `/opencode` (method, headers,
  body; responses stream, so `/global/event` stays live), and the app's
  opencode client points there. A saved opencode address (`host:4096`) is
  carried over once to `host:5199`. Opencode no longer needs to listen beyond
  this machine once every app is on this build.
- Deploy note: until this merges, the `eta` worktree runs its own API server
  on :5299 (tmux `eta-api`, state copied from epsilon's) and Metro on :8082
  (tmux `eta-metro`). In the eta app's setup, enter `100.67.32.32:5299`. The
  shared :5199/:5195/:8081 (epsilon) are untouched.

## Open

- Large files: the hub keeps the text in memory for followed files only. Reads
  are capped at `MAX_READ_BYTES` today. Keep the same cap.
- Files that are deleted or renamed while open: show it and keep the user's
  text. Decide the UI when phase 1 lands.
