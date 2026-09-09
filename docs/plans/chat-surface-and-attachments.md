# Chat surface: outside agents, and the attachment tray

**Status:** idea / design sketch, not scoped. Captured 2026-09-09 from owner chat.
**Surface:** `packages/agent-console-native` — `SessionComposer.tsx`, `MessageBubble.tsx`.
**Related:** [outside-opinion.md](./outside-opinion.md) · [rival-agent.md](./rival-agent.md) ·
[`../handoffs/agent-console-native-composer.md`](../handoffs/agent-console-native-composer.md)

Two things that arrived together, and are separable: **a third voice in the chat**, and **a
general attachment tray**. The second is a broader feature that the first happens to need first.

## Alignment grammar

The chat has two forms today:

- **Right-aligned bubble** — outgoing. What you said.
- **Full-bleed, no bubble** — the main agent. It gets the whole page because it is the primary
  voice, not a participant in a conversation.

Add a third:

- **Left-aligned bubble** — a *different* agent. outside-opinion replies, rival objections,
  anything that is neither you nor the main agent.

This is iMessage grammar and it reads instantly: **bubbles are messages from someone; the
un-bubbled column is the thing you are working with.** The consequence is a rule worth writing
down, because breaking it collapses the whole distinction: **the main agent must never be
rendered as a left-aligned bubble.** If it ever is, "left bubble" stops meaning "outsider" and
starts meaning nothing.

## Starting outside-opinion — the composer renders the form

The form that starts an outside-opinion run lives **in the composer's glass bubble** — same
bubble, different content rendered inside it. Once started, the run appears in the chat as
left-aligned bubbles.

> **This is the constraint that matters.** `SessionComposer.tsx` is deliberately *one*
> `GlassView` wrapping a `TextInput` that **never unmounts**; idle and editing are two visual
> arrangements of one persistent tree. That is invariant 1 in the composer handoff, and it
> exists because an earlier two-tree design (a decoy pill that swapped for a real input) caused
> a whole family of bugs — the glass material and `@expo/ui`'s `Host` only reliably initialise
> on a component's genuine first mount, with no supported "you got reused, redo setup" hook.
>
> So every state below — the start form, the two-button state, the reply-to-feature state — has
> to be **another arrangement of the same tree**, clipped or laid out differently. The moment
> one of them is implemented as "render a different component in the bottom bar", the bug class
> that rewrite fixed comes straight back.

## Composer states

| State | Bottom bar shows |
|---|---|
| Idle / editing | The composer as it is today |
| Starting outside-opinion | The start form, rendered inside the same bubble |
| Run in flight | (undecided — progress? a cancel? nothing?) |
| Consolidated reply arrived | **Two buttons** replacing the input: *Respond* and *Ready to send* |
| Responding to the feature | Expanded glass input, visibly addressed to the feature |
| Sending to the main agent | Expanded glass input, with the run collapsed into an attachment |

Open: the two-button state needs an **escape** — dismiss without sending, or keep the result as
an attachment for later. As described there is no way out of it but forward.

## The unsolved bit: showing who you are replying to

Tapping either button opens the expanded glass input, and there has to be a way to see that you
are talking to the feature rather than the main agent. Noted as unsolved; three candidates, in
my order of preference:

1. **A removable chip inside the input's leading edge** — `[# outside-opinion] ▸ type here…`.
   Best because it reuses the pill vocabulary the attachment tray is already introducing, and
   because it makes the reply-target **a thing you can remove rather than a mode you are in**.
   Modal input states with no visible exit are the classic version of this bug.
2. **Directional anchoring** — the feature's messages are left-aligned, so a reply-to-feature
   composer grows from the left edge while the normal composer stays neutral. Consistent with
   the alignment grammar, but subtle, and probably not enough on its own.
3. **Tinting the send button / input border** to the feature's accent. Cheapest, weakest —
   colour alone carries no name, and it fails for anyone who does not track the colour.

(1) and (2) compose. (3) should not be the only signal.

## Collapse-to-attachment

Tapping *Ready to send* collapses every left-aligned message of that run into **a single
attachment pill above the glass bar**. You then type whatever you want to add and send both to
the main agent.

The quiet strength of this is that it **turns a conversation into an object**. The
outside-opinion exchange stops being scrollback and becomes a value you can attach, which is
what makes it composable with everything else in the tray.

Two things it needs:

- **Expand back.** Tapping the pill must reopen what is inside it. Otherwise the gesture hides
  information at exactly the moment you are deciding whether to send it.
- **A dismiss.** Attaching should not be the only exit.

Pill contents are undecided — the feature name is the obvious default; a count ("4 replies")
might carry more.

## The attachment tray

Above the glass bar, and general: files, links, skills, images, feature results.

**Stacking:** same type stacks **horizontally**; different types stack **vertically**.

```
(# outside-opinion)
([] index.html)  ([] styles.css)
(@ developer.apple.com)
(⚡️/some-skill)  (⚡️/other-skill)
```

**Leading glyph** identifies the type at a glance — worth locking as a vocabulary early, since
it is the thing that makes a dense tray scannable:

| Glyph | Type |
|---|---|
| `#` | Feature result (outside-opinion, …) |
| `[]` | File |
| `@` | Link / domain |
| `⚡️/` | Skill |
| — | Image (tile, not pill) |

**Shape.** Most are pills. Images are **squares — twice as tall, same corner radius.** Worth
being precise, because "same radius" is ambiguous and the wrong reading produces a
capsule-shaped photo: a pill is a capsule, so its radius *is* half its height. A tile twice as
tall with the **same numeric radius** therefore has a radius of a **quarter** of its own height
— a squircle, not a capsule. That is the right instinct (capsule = text, squircle = media,
which is iOS's own grammar) but it has to be written as a number, not as "same radius".

**Material.** "Glass with the effect turned down." One caution: the composer handoff's invariant
1 applies here too, and an attachment tray is *by definition* a list that mounts and unmounts as
things are added and removed. Making each pill a real `GlassView` walks straight into
"glass only initialises on genuine first mount". Safer: pills are plain translucent fills
*styled to read as* reduced glass, and the only real `GlassView` in the bottom bar stays the one
persistent composer instance.

**Overflow** is unhandled as described: a horizontal row of eight files needs either a scroll or
a `+5` overflow pill. Vertical growth needs a cap before the tray eats the keyboard.

## Note for the composer handoff

This is the missing design decision behind **open work item 1** in
[`agent-console-native-composer.md`](../handoffs/agent-console-native-composer.md) — the `+`
button is a rendered `Pressable` with no `onPress` specifically because "no design decision has
been made yet" about what it attaches. The tray above is that decision, once it firms up.
