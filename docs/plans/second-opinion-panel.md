# Second-opinion panel ("this agent is being a moron" button)

**Status:** idea, not scoped. Captured 2026-09-09 from owner chat.

## The idea

A button (or skill) the owner hits when the agent in front of them is visibly stuck. It spawns
**3–4 fresh sessions**, each on a **different model**, each handed a slice of the current
transcript plus whatever extra context the owner types. Each one answers a single question:
*what is the current agent missing?*

Four rather than three so one is a spare: if the stuck session is itself running one of the
predefined models, that model is skipped and the alternate takes its place. Model list lives in
settings, defaulting to a deliberately varied set.

## Is it a good idea?

Yes, and the reason is sharper than "more opinions are better."

**The trigger is the valuable part.** Automatic stuck-detection is hard — an agent that knew it
was stuck would mostly be unstuck. But the owner's irritation is a high-signal event that is
*already being generated* and currently thrown away. Capturing it as a first-class interrupt is
the real product insight here, more than the panel itself.

**Model diversity is the active ingredient, and it is load-bearing.** A stuck agent is usually
stuck because of a wrong prior it cannot see. Re-rolling the same model tends to reproduce the
same prior; a different model family often does not share it. This matches what the LLM-jury
work found — a panel of several *diverse* models outperforms a single stronger judge, and costs
less. Diversity is doing the work, not raw capability.

## Has it been done before?

Pieces of it, yes. The combination as described, not that I have seen.

| Prior art | What it does | How it differs |
|---|---|---|
| Multi-agent debate (Du et al. 2023) | N models answer, critique each other, converge | Automatic, runs every time; no human trigger |
| Self-consistency (Wang et al. 2022) | Sample one model N times, take the majority | Same model — no prior-breaking |
| LLM juries / PoLL (Verga et al. 2024) | Panel of diverse small models judges output | Evaluation harness, not debugging a stuck run |
| Mixture-of-Agents (2024) | Layered ensemble synthesises across models | Serving architecture, invisible to the user |
| CriticGPT (OpenAI) | Model critiques model-written code for bugs | Critiques the *artifact*; this critiques the *approach* |
| Aider architect/editor | Two models, split by role | Fixed pipeline, not escalation |
| `zen-mcp-server` and similar | "Ask another model" MCP tools | Manual, one model at a time, no transcript framing |
| Claude Code subagents | Parallel agents, per-agent model | Same-family models; delegation, not second-opinion |

So: the ensemble half is thoroughly explored territory. What is not standard is **user-triggered
escalation into a cross-family panel, framed as a meta-question about the transcript rather than
a retry of the task.** Nobody has to invent the ensemble math; the design work is all in framing
and aggregation.

## The failure mode that will decide whether this works

**Handing over the transcript is what makes it useful and is also what will break it.**

Anchoring is the well-documented weakness of every debate-style setup: models shown a prior
chain of reasoning tend to adopt its framing and produce agreeable variations rather than
genuine alternatives. A stuck agent's transcript is a very persuasive document — it is
internally consistent, it is confident, and it is *wrong in a way that is not visible from
inside it*. Feed it to four models and the likely result is four polite confirmations.

The mitigation is to not give every panelist the same thing:

- **At least one gets the task and the code, but not the agent's reasoning.** A cold read. This
  is the one most likely to say the useful thing, because it cannot inherit the bad prior.
- **At least one gets the transcript with an adversarial brief:** *the conclusion in here is
  wrong; find the load-bearing assumption.* Naming the target changes what gets looked at.
- **One gets the full transcript neutrally** — sometimes the agent really is one hint away.
- The spare fills whichever slot the stuck model vacates.

That asymmetry is the design. Without it this is an expensive way to generate consensus.

## Other open questions

1. **Who reads the output?** If the stuck agent summarises the panel, it will filter through the
   same prior that got it stuck — it is the least qualified reader. Probably the owner gets three
   short verdicts side by side, and disagreement between them is itself the signal. Worth
   considering: surface *only* the points where panelists disagree with the transcript.
2. **How much transcript?** Whole thing is expensive and buries the lede; last N turns may cut
   off the decision that actually went wrong. A cheap first pass: everything since the last owner
   message, plus the task statement.
3. **Cost and latency.** Four sessions is real money and real waiting. Acceptable precisely
   because it is manually triggered and rare — but that means it must never fire automatically.
4. **What comes back.** A structured verdict beats prose: *the missed assumption*, *what I would
   check first*, *confidence*. Comparable across panelists, skimmable in ten seconds.
5. **Does the stuck session get corrected in place, or is it abandoned?** Cheapest useful v1:
   the panel just reports, and the owner decides. Feeding findings back automatically is a
   second feature and a harder one.

## Implementation sketch

Most of the machinery already exists.

- `mcp__Claude_Code_Remote__create_session` takes a `model` override, a `prompt`, and `tags` —
  so a skill can fan out four sessions on four models and tag them for collection. That is the
  whole spawn mechanism, already available.
- Claude Code subagents take a per-agent `model` in frontmatter, which is the cheaper local
  variant if cross-machine sessions are overkill.
- The `Workflow` tool would do the fan-out and structured collection in one call, but it is
  opt-in by design and would need the owner to invoke it explicitly — which fits, since this
  feature *is* an explicit escalation.

Ship shape: a repo skill at `.claude/skills/second-opinion/SKILL.md` (`.claude/` is not
gitignored here, so it commits), taking optional extra context as `args`, with the model roster
in settings.

**Naming.** "Moron button" is the honest internal name and should probably stay the internal
name. The invocation wants to be typeable while annoyed: `/second-opinion`, or `/panel`.
