# outside-opinion ("this agent is being a moron" button)

**Status:** idea, not scoped. Captured 2026-09-09 from owner chat; revised same day.
**Codename:** `outside-opinion` — owner's, and load-bearing until something better turns up.
("Panel" was my coinage and is not the name.) UI surface:
[chat-surface-and-attachments.md](./chat-surface-and-attachments.md).

## The idea

A button (or skill) the owner hits when the agent in front of them is visibly stuck.

1. Spawn **4+ sessions**, each on a **different model**, each handed a slice of the current
   transcript plus whatever extra context the owner types.
2. Each answers one question: *what is the current agent missing?*
3. A **separate small model consolidates** the replies — clusters duplicates, keeps what is
   unique.
4. The consolidated brief goes **to the owner first**. The owner decides what, if anything,
   reaches the stuck agent.

One outside agent is a spare: if the stuck session is itself running a predefined model, that model
is skipped and the alternate takes its place. Model roster lives in settings, defaulting to a
deliberately varied set.

## Is it a good idea?

Yes, and the reason is sharper than "more opinions are better."

**The trigger is the valuable part.** Automatic stuck-detection is close to impossible — an
agent that knew it was stuck would mostly be unstuck. But the owner's irritation is a
high-signal event that is *already being generated* and currently thrown away. Capturing it as a
first-class interrupt is the real product insight, more than the fan-out itself.

**Model diversity is the active ingredient, and it is load-bearing.** A stuck agent is usually
stuck because of a wrong prior it cannot see. Re-rolling the same model tends to reproduce the
same prior; a different model family often does not share it. This matches what the LLM-jury
work found — a jury of several *diverse* models outperforms a single stronger judge, and costs
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
| Requirements / specification review | Humans review a spec for defects before build | outside-opinion does it *mid-build*, on demand, with the code in hand |

So: the ensemble half is thoroughly explored territory. What is not standard is **user-triggered
escalation into a cross-family group of outside agents, framed as a meta-question about the
transcript rather than a retry of the task.** Nobody has to invent the ensemble math; the design work is all in framing
and aggregation.

## Failure mode 1 — anchoring

**Handing over the transcript is what makes this useful and is also what will break it.**

Anchoring is the well-documented weakness of every debate-style setup: models shown a prior
chain of reasoning tend to adopt its framing and produce agreeable variations rather than
genuine alternatives. A stuck agent's transcript is a very persuasive document — internally
consistent, confident, and *wrong in a way that is not visible from inside it*. Feed it to four
models and the likely result is four polite confirmations.

The mitigation is to not give every outside agent the same thing:

- **At least one gets the task and the code, but not the agent's reasoning.** A cold read. Most
  likely to say the useful thing, because it cannot inherit the bad prior.
- **At least one gets the transcript with an adversarial brief:** *the conclusion in here is
  wrong; find the load-bearing assumption.*
- **One gets the full transcript neutrally** — sometimes the agent really is one hint away.
- The spare fills whichever slot the stuck model vacates.

That asymmetry is the design. Without it this is an expensive way to generate consensus.

## Failure mode 2 — the consolidator deletes the answer

A small model for consolidation is the right call: clustering near-duplicate claims is a genuinely
easy job next to the outside agents', it is cheap, and it is fast. But the obvious way to build it
destroys exactly the signal being paid for.

**If three outside agents say the same obvious thing and one says something strange and specific, the
strange one is the reason outside-opinion exists.** A consolidator that dedupes and ranks by consensus
buries it as an outlier. Frequency is a *bad* proxy for value here — and doubly so given failure
mode 1, because outside agents who read the same anchoring transcript produce **correlated** errors.
Three-way agreement among anchored readers is close to no evidence at all.

So the consolidator's job description is narrow, and it is not "summarise":

- **Cluster, never rank by count.** Report how many outside agents raised a point as a *label*, not as
  a sort key.
- **Never drop a singleton.** A claim only one outside agent made gets shown at full length. If
  anything, surface those *first*.
- **Preserve verbatim.** Cluster by reference to the original text, don't rewrite it. A small
  model paraphrasing a subtle claim is how the subtlety dies.
- **Bias against merging.** When two claims might be the same, keep both. A redundant entry
  costs a line; a wrongly merged pair loses information permanently.
- **Tag each claim with which brief its author had** (cold-read / adversarial / neutral). "The
  cold reader and the adversary independently landed here" is meaningful; "three anchored
  readers agreed" is not.
- **No editorialising, no verdict.** It is a deduplicator and an organiser, not a judge.

A small model is adequate *because* none of that requires judgement. Give it judgement to do and
the size becomes a problem.

## Failure mode 3 — licensing outside-opinion to doubt the human

The outside agents' brief should say that the task, spec or handoff it was given **may itself contain a
mistake**, and invite a *"did you mean X instead?"* — elaborating when the alternative is likely.

This is the highest-value addition and the highest-risk one.

**Why it is high value:** a very common cause of a stuck agent is a wrong premise in the *task*,
not a wrong step in the reasoning. Agents are deferential to instructions by construction; they
will loyally implement a spec that is subtly wrong. Two live examples from this repo, both from
the Builds handoff, both human-authored, both implemented as written and flagged only in the
final report ([report](../handoffs/reports/2026-09-09-builds-page.md), open decisions 1–2):

- The handoff specified `Linking.openURL(artifacts.buildUrl)` for Install. That is the raw
  `.ipa`, and iOS cannot install from one without an `itms-services://` manifest — so the
  feature would ship looking finished while doing nothing.
- The handoff asked each list row to show relative time. `/builds` carries no `createdAt`, so
  there was no time to show.

Neither is an agent error. Both are premise errors that a outside agent with explicit license would
name in one line. That is the case for the feature.

**Why it is high risk:** "the human might be wrong" is a licence that, over-applied, produces
contrarian noise — second-guessing correct instructions, and eroding the owner's trust in the
the feature faster than any single good catch earns it. The owner's framing was right: *consider* that
there may be a mistake; do not *assume* it.

Calibration is therefore the whole game, and the way to get it is to **demand evidence rather
than suspicion**:

- A premise challenge is a **separate output slot**, never mixed into "what the agent is
  missing" — and never deduped against it by the consolidator, since they are different claims.
- It must **cite the contradiction**: the spec says A, but the API/code/test does B. A challenge
  that cannot point at both halves is not reported.
- **Elaborate only above a confidence bar.** Below it, one line naming the doubt, no essay.
  "I think this might be wrong and here is a 400-word alternative design" is the noise case.
- The **cold-read outside agent matters most here** — the one who never sees the agent's reasoning is
  best placed to notice the premise is off, because they read the task with fresh eyes and no
  inherited justification for it.
- The owner gate is load-bearing: premise challenges go to the human first by definition,
  because the human is the one who wrote the premise.

## Open questions

1. **How much transcript?** Whole thing is expensive and buries the lede; last N turns may cut
   off the decision that actually went wrong. Cheap first pass: everything since the last owner
   message, plus the task statement.
2. **Cost and latency.** 4 outside agents + a consolidator is 5+ models. Acceptable precisely because
   it is manually triggered and rare — which means it must never fire automatically.
3. **What a outside agent returns.** Structured beats prose: *the missed assumption*, *what I would
   check first*, *confidence*, and the separate *premise challenge* slot. Comparable across
   outside agents, and it gives the consolidator clean fields to cluster on instead of free text.
4. **Does the stuck session get corrected in place, or abandoned?** Cheapest useful v1: outside-opinion
   reports, the owner decides, and anything that reaches the stuck agent is pasted by the owner.
   Automatic feedback is a second feature and a harder one.
5. **Does the owner ever see the raw replies?** The consolidated view is the default, but a
   `--raw` escape hatch is cheap insurance against the consolidator being the thing that is
   wrong.

## Implementation sketch

Most of the machinery already exists.

- `mcp__Claude_Code_Remote__create_session` takes a `model` override, a `prompt`, and `tags` —
  so a skill can fan out outside agents on four models and tag them for collection. That is the whole
  spawn mechanism, already available.
- Claude Code subagents take a per-agent `model` in frontmatter — the cheaper local variant if
  cross-machine sessions are overkill.
- The `Workflow` tool would do the fan-out, the structured `schema` return, and the consolidation
  stage in one script. It is opt-in by design and needs explicit invocation — which fits, since
  this feature *is* an explicit escalation.

Ship shape: a repo skill at `.claude/skills/second-opinion/SKILL.md` (`.claude/` is not
gitignored here, so it commits), taking optional extra context as `args`, with the model roster
and the consolidator model in settings.

**Naming.** "Moron button" is the honest internal name and should probably stay the internal
name; `outside-opinion` is the working codename. The invocation wants to be typeable
while annoyed.
