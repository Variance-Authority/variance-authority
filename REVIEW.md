# Reviewing a change to variance

This file says what a review of a pull request flags here, at what severity,
and what it skips. It is the root of a cascade: every package has its own
`packages/<name>/REVIEW.md`, which adds the contracts of that package for the
changes under it. A package file narrows this one and never loosens it. How a
change is made is [`AGENTS.md`](AGENTS.md); the rules a diff is judged by are
the code rules in [change](.agents/references/change.md) and the "Not ours"
table in [`.compass/COMPASS.md`](.compass/COMPASS.md#not-ours).

## A finding is a counterexample

Variance answers questions about a change: which tests it reaches, what moved,
what a record proves. A wrong answer looks like a right one, so the defect a
review exists to catch is semantic, and tests passing does not rule it out.
Report a finding as:

1. the contract it breaks, quoted from where it is written;
2. the smallest input, configuration or state that breaks it;
3. what happens, and what should;
4. the proof: a test that fails on the head (and passes on the base, when the
   base kept the contract), a command run on a fixture with its output, or a
   trace from the input to the wrong result, file and line at each step.

A finding with its proof is **Important**, and Important is what blocks a
merge. A suspicion you could not prove is posted as a question naming the step
you could not get past. A question never blocks.

## Where the contracts come from

Write down what must stay true before reading the diff, from these sources, in
this order:

1. the task: the linked issue, or the sentence the body quotes from whoever
   asked;
2. this file, and the `REVIEW.md` of each package the change touches;
3. the specs, ADRs, compass components, README sections, JSDoc and tests that
   those files name, as the base branch holds them.

The branch's own code is not a source
([`AGENTS.md`](AGENTS.md#code-is-evidence-not-a-decision)). The PR body is read
last, and calling a broken contract "intended" clears it only with evidence.

## What every package keeps

Ask these of every path the change adds or reroutes: a composition, a
fallback, a shortcut, an early return, a threshold, a cap, a cache, a filter.

- **No path loses an answer.** Every input that reached a result on the base
  still reaches it, unless the task sets that result aside. A cap, a dedupe or
  a "claimed" set that hides a row the base showed is a finding.
- **Parts agree with the whole.** A stage asked alone and a cached answer give
  what the composed, fresh path gives for the same input. A fast path beside
  the general one is not a pair to compare: it is a second implementation,
  which the code rules already make a finding.
- **Weak evidence stays weak, in both directions.** A partial, stale, ignored
  or contested input is never reported as a definitive one
  ([ADR-0026](docs/context/adr/0026-ignored-is-not-unchanged.md)), and it does
  not clear a verdict, a rejection or a selection either: those stand until the
  evidence against them defeats them.
- **Cut from both sides.** A cap, a threshold or a claimed set is tried on
  what goes in as well as on what comes out: an input only the rows past the
  cap hold is lost as surely as a row past the cap.
- **The edges.** Try nothing: no record, no match, no hunks, an empty list, a
  switch turned off, an ignored file, a value declared rather than inferred,
  and the same input reached twice.
- **A false positive is a defect.** A tool, a page or an error message that
  reports something that did not happen is Important.

## Skip

What `yarn verify:rules` and CI hold, `dist/`, `yarn.lock`, `backlog/`, and
wording [`docs/AGENTS.md`](docs/AGENTS.md) does not rule on.
