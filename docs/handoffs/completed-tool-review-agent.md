# "Completed" tool → automatic review agent

Status: idea / doc plan. Not yet built.

## Goal

Give the agent a `completed` tool it calls after finishing a real piece of work
(anything more than a throwaway prototype). Calling it triggers a **separate
review agent** that checks the work, so completion is always followed by an
independent verification pass rather than the same agent marking its own homework.

## Shape

- A **skill** gates the behavior: when enabled, the agent is instructed to call
  `completed` at the end of a substantive unit of work (a feature, a fix, a
  refactor) — explicitly *not* for prototypes/spikes/exploration.
- The `completed` tool call carries a short description of what was done and the
  scope to review (changed files / diff range).
- On the call, spawn a **review agent** (fresh context) that:
  - inspects the diff/scope,
  - checks correctness, adherence to the repo's standards/Bible, and that the
    work matches the stated intent,
  - reports findings back (surfaced to the user, and/or to the original agent to
    address).

## Notes / open questions

- Where it runs: this is a dev-workflow/agent-harness feature, not an
  agent-console app feature — decide the host (Claude Code tool + skill, or the
  DoubleAgent/opencode side).
- Trigger threshold: "more than a prototype" needs a crisp definition in the
  skill so it doesn't fire on every trivial edit.
- Relationship to existing review tooling (e.g. `/code-review ultra`): the
  `completed` trigger could invoke the same review machinery rather than a bespoke
  one.
- Loop guard: the review agent's findings shouldn't auto-retrigger `completed` in
  a cycle.

(User first raised this earlier; captured here per request to "add it to doc
plans.")
