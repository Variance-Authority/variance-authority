# Understand an execution

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

This page indexes a second reading the same run keeps. Not the comparison, but
the **execution** behind it: one test's work, from the moment your runner starts
it to the moment it ends, across every process it touched. Read this page when a
comparison or an assertion has already told you *that* something changed and you
need to find out *where*. New here? Start with [your first run](start.md).

An assertion records one answer to one question you chose before the run. An
execution knows more than that answer: which elements the test operated, which
regions of your source it entered, which components rendered, what your
application code announced while it ran, and what work it opened and never
closed. Keeping those readings is what lets you ask, after the run, a question
you did not think to ask before it.

This is not application observability. Nothing here wires into an APM or reads
metrics, logs and traces off a production system: the traced thing is one test
execution, the retention is a file written beside your report, and the consumer
is you or the next run. [Observability contracts](observability.md) draws that
line in full.

## Start here: which part of a module two subjects took differently

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id such as `story:cart-card--removing`. A subject's
**journey** is the path one execution took through your source — the set of
regions it entered while that state was painted, where a region is a function
body, a branch, a `case`, a loop body or the code after an `await`.

Three stories can mount the same component from the same file and still have run
different code. `variance journeys` is the reading that tells them apart:

```bash
npx variance journeys --file CartCard
```

```
app/src/components/CartCard.tsx  3 observers
  parted     function CartCard/onClick  51-58
    entered  story:cart-card--removing
    missed   story:cart-card--item, story:cart-card--verbose
  unentered  branch CartCard/empty  62-64

pool: 3 observations the journal recorded whole, out of 3 subjects the report names
```

`parted` names a region one subject entered and the others did not. `unentered`
names a region no subject reached at all. [Read the journey](journeys.md) covers
what recording one costs — a flag in your collector or Playwright config, plus a
`testSelectionProbes()` step in the build that bundles your product source — and
what to do with the answer.

## Choose by how long the evidence lives

Each reading below survives for a different span. One exists only while the
suite is still running; the rest are written out and can be read afterwards.
Ask the question the evidence can still reach.

| Question | What answers it | Page |
| --- | --- | --- |
| What is a running suite doing right now? | The tests each worker has opened, what your application code announced while they ran, and work that opened and never closed — readable from another shell, and gone when the suite ends | [Watch a run that has not finished](vantage.md) |
| What did the page know before teardown? | The observations your installed instruments recorded while the page was alive, written out with the report | [Ask beyond the assertion](observability.md) |
| Which elements did the test address? | The element each query or locator resolved to, joined to the React component that rendered it and the source that wrote it, where React mounted the element | [What a test witnesses](eyes.md) |
| Which regions of source did one execution enter? | A journey across every instrumented process the execution touched | [Read the journey](journeys.md) |
| Where did two runs of the same flow stop agreeing? | Each observed Arrange–Act–Assert step, the state it began from, and a digest of what it changed | [Compare scenarios](scenarios.md) |
| What can this test drop without losing what it proves? | The elements it addressed and the regions it entered, then one rerun of the same test with a single substitution in place | [Distil the test](distill.md) |

## Readings join on recorded ids

The readings are worth more together: an addressed element can name the
component that produced it, a journey can connect one browser action to the
branch a service took, and an update outside the path the test addressed can
point at behaviour nothing is covering.

Those joins use ids that both sides recorded. Where one side did not, the run
refuses the join and names the half that was missing, rather than matching on
similar titles, timestamps or display names.

## Where execution evidence stops

Execution evidence explains what the run did and what it observed. It does not
change your assertions, approve a baseline, or treat silence as proof that
nothing happened — a reading no instrument took is missing from the report
rather than present and zero.

So the answer you can get depends on what was running at the time. A live view
of a suite ends with the suite. A retained record says only what the instruments
you installed could see. When the evidence a question needs was never recorded,
ask a narrower question of what you do have, or turn the instrument on and run
again; [Observability contracts](observability.md) lists what each one costs.
