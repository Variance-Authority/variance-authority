# Spec 0013 — A real agent

**Not proven.** The loop this spec specifies is the **author loop**: an agent
editing components and verifying its own work before any human sees it, which is
the loop the README's first sentence promises and the one nothing here serves.
The fixer loop — an agent reading a CI report after the fact — is the smaller
half and keeps one paragraph at the end.

What exists: eight MCP tools as pure functions over a run report, a protocol
codec, `variance serve` — tested against text
([`packages/mcp/src/tools.ts`](../../packages/mcp/src/tools.ts)). One of the
eight is `variance_adjudicate`, and `variance adjudicate --claims` is the same
thing at the CLI: a declaration read back against a run, all three arms,
over-claiming visible, exercised end to end by
[`examples/agent-claim`](../../examples/agent-claim). What it reads back is a
*finished run*, not a held observation — the agent declares, runs, and is
answered, which is the fixer loop's shape applied to the agent's own work. The
author loop's cadence, where the observation is held across the edit, has no
boundary yet. `Intent` and the docket-shaped `adjudicate` in
`packages/core/src/judge/intent.ts` — the half that could turn a red run green —
still have no caller and want a durable place to declare a claim before the
branch that exercises it.

## The loop, stated as a session

An agent building UI works in a cadence: edit, look, edit, look. A person doing
this has a dev server and eyes; the agent has neither, and the substitutes on
offer are screenshots it must interpret with vision tokens. Every shipping
agent integration — Applitools' MCP, Chromatic's, LambdaTest's — hands the
agent an image or an approval button at that moment. The thesis here is that
the agent should instead be handed the sentence this system already produces:
a cause, a component, a `file:line`, and a count of what else moved.

The loop, concretely:

1. The agent observes a subject. The observation is held.
2. The agent edits a component.
3. The agent observes again and is answered with the difference against the
   *held* observation: `cause — Toggle src/ds/components.tsx:107`, collateral
   counted, ranked from provenance.
4. It iterates, or declares itself done and hands the accumulated difference
   to a human as part of its proposal.

The comparison target in this loop is **the previous observation of this
session** — not a stored baseline, not CI's image, not anything with an
identity problem. Both sides are rendered now, by one renderer, so the machine
cancels out by construction
([ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md)), and both
sides are *documents*, which is the fact everything below turns on.

## Why the best answer is only available here

Two documents are what the `cause`/`collateral` ranking costs. The durable
path cannot rank — a stored baseline is an image with no document behind it —
and `observePair` carries one snapshot, so it attributes and stops. The
composition that produces the full answer, `diffSnapshots` over two documents
then `isolateRegions` → `attributeRegions` → `rankRegions`, runs today in
exactly one place:
[`examples/todomvc/src/observe.chromium.test.ts`](../../examples/todomvc/src/observe.chromium.test.ts),
a test file.

A session that holds the previous observation has two documents *by
construction*. The author loop is therefore not a degraded convenience mode —
it is the only setting in the system where the strongest answer is structurally
guaranteed. The README's own worked example — the ranking that put the edit
above the 6×-larger reflow — is loop-B output wearing a test file as a
costume. What is missing is the boundary an agent reaches it through.

## The half-sentence intent adds

The agent knows what it meant to do, and until something asks it, observation
answers "what changed" and stops there. Asked, it answers **"what changed
against what you claimed"**. That question is now reachable — `variance
adjudicate` and `variance_adjudicate`, both over a completed run — and what
remains is asking it *inside* the loop, against a held observation, where the
answer arrives before the edit is finished rather than after. The adjudication
has three arms, each worth naming because they are different products:

- **Claimed and observed.** Confirmation. The edit did what the agent said.
- **Observed and unclaimed.** Collateral the agent did not intend — the reflow
  it should mention in its proposal or go fix.
- **Claimed and not observed.** *The edit did not take.* Wrong file, dead
  branch, a rule something else overrides, a stale build. This is the arm
  nobody in the category ships, and it is the one aimed at the failure mode
  agents actually have: acting, observing nothing, and proceeding on the
  belief that the action landed.

An agent that claims everything to game the second arm walks into the third:
a claim with no matching finding is reported, not absorbed. Over-claiming is
visible by construction.

## The surface, envisioned

A standing observation session the agent's own dev session owns. Names are
proposals; the count is deliberately small, and the experiment below decides
what survives.

- **`observe`** — re-collect a named subject (or the subjects a named
  component reached last time — the reverse map the report already carries and
  `variance_trace_component` already reads), diff against the held
  observation, answer cause-first. Semantic tiers settle what they can; a
  paint happens only when a raster question is asked. In a warm world a paint
  costs roughly an order of magnitude more than a semantic capture, which is
  what makes cause-first affordable.
- **`claim`** — declare intent for the next observation; the answer leads
  with the two arms that are not confirmation.
- **`findings`** — the nine inspection rules over the current render, scoped
  to *what this session introduced*: a defect present at session start is
  context; one that appeared under the agent's edits is its to fix, named
  with a component and a file before any human review.

## The shape, and the decision it forces

Two shapes are available — a subject-scoped `variance run` the agent invokes per
iteration, or a live server holding the persistent harness. The scoped run is the
cheaper move and it is the wrong one, for a structural reason rather than a
latency one: **a stateless run has no held document.** Against a durable baseline it ranks by area, the
ordering journal 0013 measured as backwards; the scoped run is not a slower
version of the loop, it is a different loop with a worse answer. The
session-holding server is not an optimization of shape 1 — it is the only
shape that delivers the two-document answer the loop exists for.

What it costs is honesty about state: a long-lived process, a browser hanging
off it, and held snapshots. Three boundaries keep it from becoming a second,
stranger system:

- It composes what exists — the harness, a collector, `diffSnapshots` and the
  attribution chain — and decides nothing itself. The one hard-wired phase
  order stays in [`observe`](../../packages/observe).
- It is a separate binary or CLI mode, never a widening of the five report
  tools. `packages/mcp` stays a pure reader of reports.
- Held observations are documents and hashes, never accumulated pixels — the
  standing constraint applies to a session's memory as much as to history.

There is a second route to two documents — teach the durable store to keep the
render document beside the image, which would also close the "no ranking on
the durable path" gap in CI. That is real and it belongs to
[spec 0011](0011-storage-and-cache-primitives.md)'s seams, not here: it serves
the CI loop, and no sidecar makes a stateless per-edit invocation match a warm
session's cadence.

## What an agent may not do

Nothing in this loop touches a baseline, and that is a property to state, not
an accident: session observations are held, compared, and discarded. When the
agent is done, what it hands over is a **proposal** — the accumulated
difference, its own claims, and the adjudication — and promotion stays where
[ADR-0021](../context/adr/0021-approval-promotes-an-image-that-already-exists.md)
and [ADR-0022](../context/adr/0022-deciding-is-not-writing.md) put it: with an
operator. A session that could quietly `accept` on exit converts every agent
misjudgment into a stored baseline with an approval attached, which is the one
outcome worse than no tool.

## The standing world is a shared world

A session that never rinses is exactly the arrangement
[spec 0012](0012-order-dependence-in-a-run.md) exists for, amplified: an agent
session is longer than any CI run, and an agent is worse than a person at
suspecting its tools. A leaked stylesheet from observation 12 shows up in
observation 40 as "your edit changed `Card`", the agent dutifully
investigates a component nobody touched, and every conclusion after that is
poisoned. The clean-world discriminator applies here unchanged — before the
session reports a difference as the agent's, it should be able to say the
difference reproduces alone — and the budget argument applies too: the check
runs on report, not on every observation.

## The measurement that would settle it

Author-loop tasks, pre-declared in the corpus style. The existing mutation
corpora run backwards: instead of "here is a broken build, fix it", the task
is "make this declared change" — the same edits
[`cases/incumbent-case`](../../cases/incumbent-case) and
[`examples/todomvc`](../../examples/todomvc) already define, with ground truth
about what each one collaterally moves.

- **Two arms, same model, same budget.** Arm one: the agent edits and checks
  its work however it likes — the status quo, typically a screenshot or
  nothing. Arm two: the agent holds the observation session.
- **Scored on the proposal, not the vibes:** did the intended change land; is
  every collateral effect either fixed or *named in the proposal*; did the
  agent catch its own edits that did not take (the corpus can seed these
  deliberately — an overridden rule, a wrong file with a plausible name); at
  what cost in turns and tokens.
- **The tool list is corrected by the transcripts.** A tool no agent called is
  deleted; an answer that sent the agent to the wrong file is a defect with a
  transcript attached — the standard journal 0014 set.

The fit caveat carries over: this corpus was written by the pipeline's
authors, so the experiment measures whether the loop's answers are
*actionable*, not whether its verdicts are *right*. The second question still
needs someone else's codebase.

## The fixer loop, retained in one paragraph

Loop A — an agent taken from a red CI run to a green one through the five
report tools — keeps exactly its existence proof: one recorded session, real
agent, real stdio, journaled with which tools it called and what each answer
did. It is cheap, it exercises the surface that already ships, and nothing in
it blocks on the session work above. Its two-arm experiment is deferred until
the author loop's runs; the transcripts from these will reshape the report
tools anyway, and measuring a surface twice — before and after the reshaping —
is paying for the same evidence twice.

## What would discharge it

0. **The session boundary as an ADR** — a standing observation session: what
   it holds (documents and hashes, never pixels), what it may never do
   (accept), and where it lives (a binary or CLI mode composing `observe`,
   the harness and a collector; not in `packages/mcp`).
1. **The surface, minimally** — `observe` and `claim` over one collector
   (Storybook is the shipped one), answering from the held document with the
   full attribution chain.
2. **The intent wire** — `adjudicate` reachable at that boundary, all three
   arms reported, over-claiming visible. *Reachable over a completed run:*
   `variance adjudicate --claims` and `variance_adjudicate`, with the census
   splitting the third arm into *rendered and held still* and *never rendered*.
   What is left is the same wire against a held observation, which is item 1's
   boundary and not this one's.
3. **One recorded authoring session** — a real agent, a declared edit, the
   transcript journaled: what it observed, what it claimed, what the third
   arm caught.
4. **The two-arm authoring experiment**, pre-declared, scored on the proposal,
   tool list corrected by the transcripts.
5. **Loop A's existence proof**, as above.

## Known limits

- **Bounded by the collector story.** An agent can only observe what a
  collector can mount; beyond Storybook, a Playwright suite and a route map,
  the mounting half is the adopter's ([surface.md](../surface.md)), and no
  agent surface changes that.
- **One agent is one sample.** Fix rates and token costs are properties of a
  model, a harness and a prompt scaffold as much as of these tools. The
  between-arms comparison transfers better than any absolute number.
- **A held observation drifts from a clean one.** The shared-world risk above
  is mitigable and reportable, not removable; module-scope leaks stay
  invisible to any probe, exactly as spec 0012 concluded.
- **Intent is declared, not verified.** The adjudication scores claims against
  findings; it cannot know the agent's claim matched the user's actual ask.
  That gap belongs to whoever reviews the proposal, and no arm of this closes
  it.
