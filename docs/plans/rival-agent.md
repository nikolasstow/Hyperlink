# Rival agents

**Status:** idea, not scoped. Captured 2026-09-09 from owner chat.

## The idea

Add one or more **rival** agents to a session. They follow along, reading what the main agent
does, and **stay silent unless they disagree**. No summaries, no "looks good", no presence at
all until there is an actual objection.

Sibling to the [second-opinion panel](./second-opinion-panel.md), but the opposite shape:
the panel is expensive, on-demand, and triggered by the owner's frustration. The rival is
cheap, continuous, and triggered by the *work*.

## The closest working precedent is a linter

Not the multi-agent-debate literature — a **linter**. A linter watches everything, says nothing
when it agrees, and complains when it doesn't. That is precisely this design, and it comes with
thirty years of hard-won operational knowledge.

The lesson from every linter ever disabled: **teams turn them off over false positives, not over
misses.** Nobody ever removed a linter because it failed to catch something. They remove it
because it cried wolf on line 40 of every file until the warnings became scenery.

So a rival should be tuned for **precision, not recall**. Better to miss three real disagreements
than raise one bad one — because one bad one costs you the whole feature, and a miss costs you
nothing you didn't already not-have. This is counterintuitive and is probably the single most
important tuning decision.

Other prior art is thinner but real: the pair-programming navigator; institutional
devil's-advocate roles created specifically because consensus failed (the *advocatus diaboli*;
Israeli military intelligence's Tenth Man after Yom Kippur); PR review bots; and the critic half
of Reflexion / self-refine architectures — though those are one model critiquing *itself*, which
is exactly the prior-sharing problem cross-model rivals avoid.

## The threshold is the entire feature

An agent that speaks only on disagreement has to decide, every turn, whether this disagreement
clears the bar. That judgement *is* the product.

- Too low → constant interruption → muted → dead.
- Too high → never speaks → forgotten → dead.

And the failure is asymmetric in an ugly way: the low-threshold version fails **loudly and
immediately**, the high-threshold version fails **silently and permanently**. You will find out
about the first one in an hour and the second one never.

## The silence problem

If a rival never speaks, there is no way to tell agreement from a crashed process. Silence needs
to be distinguishable from absence — some minimal heartbeat, a status pip, a count of turns
reviewed. Cheap to build, and without it the feature has no trust story: you cannot rely on
"it would have said something" unless you know it was watching.

## What it should watch

Not every token. Line-level code review is `/code-review`'s job and already exists. A rival earns
its keep at **decisions**:

- choosing an approach ("I'll use X because Y")
- interpreting an ambiguous spec
- declaring something verified
- deciding *not* to do something — the silent scope cut, which is the hardest class for a human
  to notice and the easiest for an agent to make

## Rival quorum

The owner said "one or more". More rivals multiply noise — unless they have to agree with each
other first. **N rivals on different models, and an objection only surfaces when ≥2 raise it
independently.** That converts the precision problem into a cheap voting mechanic, and the
cross-model requirement means agreement is meaningful rather than correlated.

Note this is the *opposite* of the panel's consolidation rule, and correctly so. The panel
prizes the lone dissenting voice because the owner is already engaged and paying attention. The
rival interrupts unbidden, so it must clear a higher bar. Same family, inverted economics,
inverted aggregation.

## Who does it talk to?

Probably the **owner, not the main agent** — same reasoning as the panel's owner gate, plus one
more: if the main agent can see the rival, the likely outcomes are capitulation (sycophancy
toward the objection) or defensive argument. Both burn tokens, neither is thinking. A rival that
addresses the owner keeps the main agent's trajectory clean and leaves the routing decision with
the person who can actually judge.

## Composition with the panel

The natural escalation path: *"I've objected three times and been overruled — want the panel?"*
The rival is the cheap always-on detector; the panel is the expensive on-demand investigation.
A rival that has been repeatedly overruled is a strong, and currently unavailable, signal that
the session has gone wrong.

## Open questions

1. **Cost.** Continuous, so it scales with session length rather than with incidents. Wants a
   cheap model with a high bar, or event-driven wake-ups on decision points only rather than
   every turn.
2. **Does it see tool output or just the conversation?** Objecting to a claim of "tests pass"
   requires seeing the test output. That is most of the context.
3. **Does an objection interrupt, or queue?** Interrupting mid-edit is disruptive; queuing until
   the turn ends may be too late to prevent the work.
4. **Does it persist across sessions?** A rival with memory of what it objected to last time is
   more useful and considerably more annoying.
5. **How is it dismissed?** "Noted, proceeding" needs to be one keystroke, and the rival needs to
   not re-raise the same point — a muted objection should stay muted.
