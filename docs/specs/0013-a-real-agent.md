# Spec 0013 — A real agent

**Not proven, 2026-08-05.** The MCP surface exists — five tools as pure
functions over a run report, a protocol codec, `variance serve` — and is tested
against text ([`packages/mcp/src/tools.ts`](../../packages/mcp/src/tools.ts), 27
tests). No agent has ever called any of it. Every answer's shape was decided by
argument about what an agent needs, and the question the package's own comment
calls the interesting one — *does this answer help an agent fix the thing?* —
has never been asked of an agent.

## Why this spec exists at all

The agent case is the strongest case for the design and the weakest case
evidentially, and [comparison.md §5](../comparison.md#5-when-not-to-choose-this)
already says so. What has changed since that sentence was written is the
market: Applitools ships an Eyes MCP server that scaffolds tests and approves
results from the IDE, Chromatic publishes Storybook MCP endpoints, LambdaTest
ships a SmartUI MCP. The plumbing is no longer a differentiator — everyone has
a socket.

What nobody else has is the content of the answer. Every shipping agent
integration hands the agent a screenshot, a count, or an approval button. A
screenshot handed to an agent costs vision tokens and returns a guess;
`cause — Text src/ds/components.tsx:42` is an instruction. The thesis of this
project's agent story is that **a verdict carrying provenance is the only
category of VR output an agent can act on without guessing**, and that thesis
is currently held entirely on argument.

This spec states what is missing between the surface that exists and the
evidence that would make the thesis a finding.

## Two loops, and they are different products

**Loop A — the agent as fixer, after the fact.** CI ran, the report exists,
an agent is asked to make the build green. It reads the docket through the five
tools, opens the file the answer names, edits, re-runs. This is the loop the
shipped tools were shaped for: every answer is a sentence with a path on the
end, and the report is the whole boundary — the run may have happened on a
pinned machine an hour ago.

**Loop B — the agent as author, before the fact.** An agent editing a
component wants to know what its own edit changed *before a human sees it*.
This is the loop the README's first paragraph promises ("built for agent-driven
development") and the one no shipped tool here serves. It is also the loop the
architecture is accidentally best at: ephemeral retention
([ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md)) compares
two documents rendered now, by one renderer, with nothing stored — no baseline
infrastructure, no identity problem, exactly the situation of an agent holding
a before and an after. And carrying two documents is what buys the
`cause`/`collateral` ranking, so the loop-B answer is the *best* answer the
system produces, not a degraded one.

Loop B has a missing half-sentence: the agent knows what it meant to do.
`Intent` and `adjudicate` exist in `packages/core/src/judge/intent.ts` —
declared claims scored against findings — and nothing lets an agent supply an
intent at any boundary above the library. The answer loop B should produce is
not "what changed" but **"what changed that you did not claim"**: an agent that
says "I changed the primary button color" should be told the color changed,
`Stack` reflowed, and the second is not in its claim. No tool in the category
has this shape, because no tool in the category has either half of it.

## What invocation does not need

The MCP package never runs anything, and that stays. An agent has a shell; the
exit code is the interface
([ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md)); `variance
run` is as callable by an agent as by CI. Invocation is not the gap.

The gap for loop B is grain and latency. A suite-shaped `variance run` is the
wrong unit for "I just edited `Button`" — the agent wants one subject, two
documents, the semantic tiers, and at most one paint. Two candidate shapes,
decide before building:

1. **Scope the run.** A subject filter on `variance run` plus ephemeral
   retention. The agent edits, runs the one subject, reads the report through
   the existing tools. No new machinery, no new contract; costs a process
   launch and a browser launch per iteration — the 205 ms cold number, not the
   7.5 ms warm one, every time.
2. **A live observation server.** A long-lived process holding the persistent
   harness, exposing an `observe` tool over MCP: the agent names a subject and
   gets the ephemeral pair verdict from a warm world. This is the loop the
   27× warm/cold measurement was made for — but it breaks the report-reader
   contract (`packages/mcp` stops being pure, a browser hangs off a server
   process), so it must be a second binary or a CLI mode, never a widening of
   the five report tools.

Shape 1 is the honest first move: it ships with no new decisions and its
slowness is a measurement that either justifies shape 2 or does not.

## What an agent may not do

An agent must not accept a baseline, and this is a boundary to state before
any loop is demonstrated, because the failure mode is silent: a tool that lets
an agent bless its own change converts every agent mistake into a stored
baseline with an approval attached. The decision is already made for people —
approval promotes a candidate that already exists
([ADR-0021](../context/adr/0021-approval-promotes-an-image-that-already-exists.md)),
and deciding is not writing
([ADR-0022](../context/adr/0022-deciding-is-not-writing.md)) — and it holds
harder for agents. What an agent may do is **propose**: draft the acceptance
rationale, attach the adjudication of its own declared intent, and leave the
promotion to an operator or a tribunal reviewer. A proposal is text; text is
what these tools emit.

## The measurement that would settle it

The corpus already contains what an agent experiment needs: mutations with
ground truth declared before any pipeline ran —
[`examples/kitchen-sink`](../../examples/kitchen-sink)'s changed cases,
[`examples/todomvc`](../../examples/todomvc)'s nine mutations,
[`cases/incumbent-case`](../../cases/incumbent-case)'s eight scenarios with a
named component each.

The experiment, pre-declared in the corpus style:

- **N mutations, one agent harness, two arms.** Arm one hands the agent what
  the category hands it today: the images and a pixel count. Arm two hands it
  the report through the five tools. Same model, same prompt scaffold, same
  budget.
- **Scored on outcome, not on vibes:** did the agent edit the file that
  ground truth names; is the re-run green; did it touch anything else; how
  many turns and tokens did the fix cost. Declare the success criteria before
  the first session runs.
- **The tool texts become measured artifacts.** A tool no agent called across
  the whole experiment is deleted. An answer that sent the agent to the wrong
  file is a defect with a transcript attached — the same standard journal 0014
  applied to the CLI's first execution.

One caveat is owed in advance: this corpus was written by the people who wrote
the pipeline, the same fit risk the M0 scores carry. An agent experiment on it
measures whether the answers are *actionable*, not whether the verdicts are
*right* — the second question still needs someone else's codebase.

## What would discharge it

0. **One recorded session.** A real agent, over stdio, taken from a red run it
   has never seen to a green one, on a corpus mutation. No scoring, no arms —
   the existence proof, journaled with the transcript's facts: which tools it
   called, in what order, what it did with each answer.
1. **The two-arm experiment above**, pre-declared, scored, journaled — including
   the rows where the pixel arm wins, if it wins any.
2. **The tool list corrected by evidence.** Delete what went uncalled, fix what
   misled, and record in an ADR why each surviving answer has the shape it has.
3. **The loop-B shape decided.** Shape 1 shipped and measured, and the
   measurement either buys shape 2 or retires it. ADR either way.
4. **The intent wire.** An agent can declare what it meant to change at the
   same boundary it invokes a run, and the answer leads with what fell outside
   the claim. `adjudicate` exists; what is missing is the way in.
5. **The proposal boundary as an ADR.** What an agent may do to a baseline —
   propose, never promote — stated once, where the tribunal and the CLI can
   both cite it.

## Known limits

- **One agent is one sample.** Fix rates and token costs are properties of a
  model, a harness and a prompt as much as of these tools. The comparison
  between arms transfers better than any absolute number, and even it should
  be read as evidence, not proof.
- **The corpus measures actionability, not correctness.** See above. A
  held-out repository remains the gate for the verdicts themselves.
- **Loop B's demonstration is bounded by the collector story.** An agent can
  only observe a subject some collector can mount; for anything that is not a
  Storybook, a Playwright suite, or a route map, the mounting half is still
  the adopter's ([surface.md](../surface.md)), and no agent experiment changes
  that.
- **A proposal surface invites over-trust.** An operator who rubber-stamps
  agent proposals has reinvented agent acceptance with extra steps. The
  boundary keeps the writer honest; it cannot keep the reviewer awake.
