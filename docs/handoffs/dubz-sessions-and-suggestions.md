# Dubz: sessions-in-window + context-driven suggestions

Decisions doc. The SSOT for the Dubz suggestion/session feature. Read this
before generating anything; update it as decisions change.

Dubz is the assistant surface (a glass bar/window that rides the keyboard —
`src/Dubz.tsx`). It is a combination of **automation scripts** and **models**
(classification, coding, and more). Laya (`~/Coding/laya`) is the brain; the app
is the surface.

## The vision

When you are on a page that has anything an agent could change for you, the page
supplies **context** and Dubz offers **suggestions without the user typing**.

Example: the package *page* (not the package file) exposes an *editable document*
pointing at the manifest, plus model instructions. From that, Dubz can offer
"Edit Document" and show the sessions that recently touched that file — all
without a keystroke.

## Model

### 1. Pages supply capabilities, not UI

`DubzContext` (today `{ surface, scope }`) gains `entries` — each a thing on the
page Dubz can act on, carrying everything a script or model needs. Declared as
an **Effect `Schema`** (it crosses into Laya, model prompts, and maybe
persistence/sync, so we want validation + a JSON codec + principled evolution —
the same standard as the rest of the wire/stored data here). Pages still build
plain object literals; we decode only at the boundaries.

A **tagged union over a shared `FileRef`**, discriminated by **`_tag`** (Effect's
idiom — `Schema.TaggedStruct`, `Match.tag`):

```
FileRef = { repo; path; name; kind: "file" | "directory" }   // the FileNavEntry shape, reused

DubzContextEntry =
  | { _tag: "EditableDocument"; id; file: FileRef; instructions?; label? }
  | { _tag: "ReferenceDocument"; id; file: FileRef; label? }   // read-only context
  // expand by adding more well-defined kinds — never a catch-all

DubzContext = { v: 1; surface; scope; entries: DubzContextEntry[] }
```

Context stays a cheap plain value built at page open, so it is ready before the
tap (preload-before-tap). Pages declare capability + data + model instructions;
they do not build suggestion UI.

**Schema standard (owner's call):**
- **No catch-all.** No `custom`/opaque-`data` entry. Every capability is its own
  typed entry, "everything in its place." Extensions/plugins extend the schema
  by contributing **well-defined** entry kinds (when the extension host lands),
  not an opaque blob.
- **`_tag` discriminator**, and the repo is held to that standard: the existing
  `kind`-discriminated Dubz unions (`DubzScope`, `DubzSuggestion`) are migrated
  to `_tag` as part of this work rather than left half-and-half. (A file's
  `kind: "file" | "directory"` stays — that's a value, not a union tag.)
- **Additive-only evolution**: new fields optional; a `_tag` is never
  repurposed. The resolver **ignores unknown `_tag`s** so a newer page and an
  older build tolerate each other; top-level `v` is the coarse hard-break gate.
- **Per-entry `id`** so a suggestion can point back at the entry that produced
  it, and the UI can update/dedupe.

### 2. Scripting turns entries → suggestions

A resolver (extends `suggestionsFor`) maps entries to suggestions from two
sources:

- **Capability actions** — `editableDocument` ⇒ an *Edit Document* toggle.
- **Data lookups** — the file ⇒ *relevant sessions* (which sessions last touched
  it) as chips.

Deterministic first (no model). A classification model can rank/select later.

### 3. A suggestion = presentation + behavior

- **presentation**: `pill` · `pills` (a row) · `rectangle` (rounded glass) ·
  `grid` (one suggestion whose cell has sub-rows). Each presentation type is one
  row; only a grid item has sub-rows.
- **behavior**:
  - `action` — runs immediately.
  - `toggle` — arms a mode needing more input before running (Edit Document:
    toggle on, then say how).
  - `navigate` — opens a sub-page **inside the Dubz window**.
  - `entity` — a reference chip (a relevant session: name + `[icon] <n>`); tap
    opens it. `<n>` = the session's unread count (matches the app's unread dot)
    unless decided otherwise.

### 4. Presentation = native glass

Follow the existing `TaskSuggestion.tsx` pattern: one SwiftUI `Host`, native
glass, fixed heights, nothing measured.

### 5. Sub-pages inside Dubz

A small nav stack **within** the Dubz window (separate from app navigation),
with a back chip top-left → main Dubz. Opening a session renders its chat inside
Dubz while the file context stays in view.

### 6. Edit Document (toggle) — later

Toggling arms the composer ("How should I change package.json?"); sending runs
the edit with the file ref + the page's model instructions prepended. How it
runs is the curated-conversation question below — **lower priority**.

## Decisions (from the owner)

### Relevant sessions = invert per-session touched-files

> "You're not checking the files for recent sessions, you're checking the
> sessions for a specific file."

Each session already derives its touched files from its transcript
(`sessionFiles(messages, directory)` in `SessionChatScreen.tsx`; shown as the
file chips). The lookup is the **inversion**: for a given file path, find the
sessions whose touched-files include it, ordered by recency. Free for
transcripts already cached (`transcriptCache` / `sessionPreview`); build a
file→sessions index from what is loaded. No new backend.

### No singular "Dubz session" — curated conversation (LOWER PRIORITY)

> "In an LLM, sessions don't actually exist — you're starting a new convo each
> time with the history of the previous one. If we control how that works there
> is no Dubz session, no singular chat history. The automation scripts plus Laya
> classification can change the history of the conversation to get efficient,
> high-quality responses."

**Feasibility: yes.** A "session" is just a stored message list; a completion is
`system + messages`. If Dubz assembles the message array itself per request
(rather than delegating to one opencode session) it can, each turn:
- prepend the page's model instructions + the file snapshot,
- include only the relevant slice of history (or a Laya-summarized version),
- send a one-off completion, apply the result (e.g. the edit).

**What it takes:** a *conversation assembler* — (1) gather candidate context
(page entries, file snapshots, selected prior turns/snippets), (2) Laya
classification ranks/selects/compresses it into a token-budgeted message list,
(3) call the coding model directly, (4) apply the result. This is a custom
orchestration layer over the raw model that bypasses opencode's session
abstraction for Dubz's quick actions. Buildable, but it is the bigger piece — so
it is **deferred** behind the easy, high-value win below.

### When to promote to a "real" session (FOR LATER)

Dubz handles quick one-offs with curated context. When the work grows — the user
keeps asking Dubz to make changes, or Laya detects it is getting involved — a
suggestion becomes **Create a Session** (a persistent opencode session that
shows in the session list). Less important than getting existing sessions in the
window.

## Increments

**Increment 1 (next — easy, high value): open existing sessions in the Dubz
window.**
- `DubzContext.entries` plumbing + `editableDocument` published by the file
  page.
- file→sessions lookup (invert `sessionFiles`), relevant-session chips.
- glass presentation (pill / pills / rectangle) per `TaskSuggestion`.
- Dubz sub-page nav (back chip) + open a session's chat inside the Dubz window
  (continue the conversation while the file stays in view).

**Increment 2 (later): acting on documents.**
- Edit Document toggle → compose the change.
- curated-conversation assembler (scripts + Laya) to run it.
- "Create a Session" suggestion after repeated change requests; promotion to a
  real opencode session.

## Touch points

- `src/Dubz.tsx` — the window, the suggestions area, the `Suggestion` switch.
- `src/dubzSuggestions.ts` — `DubzContext`, `DubzSuggestion`, `suggestionsFor`.
- `src/TaskSuggestion.tsx` — the glass-suggestion pattern to follow.
- `SessionChatScreen.tsx` — `sessionFiles`, the chat to reuse inside Dubz.
- `src/sessionPreview.ts` / `transcriptCache` — cached transcripts for the
  file→sessions index.
