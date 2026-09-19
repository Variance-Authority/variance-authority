# Follow the reasoning loop

You already have visual regression covered — `toHaveScreenshot`, Chromatic,
Percy, `jest-image-snapshot` — and the question you bring to a red build is
rarely *did these pixels move*. It is which tests this edit could reach, whether
the change on screen is the change somebody authored, or why one state keeps
disagreeing with itself. [Variance Authority](README.md) answers those from
different readings — a parse of the source, a completed run report, a record of
what previous executions entered, a suite still running — and asking the wrong
one pays for a full suite render to get an answer a source reading already had.
This page is how you pick the reading before you pay for it.

## Start from the decision, not the tool

A **subject** is one named UI state a run captures and compares against its
approved baseline — a Storybook story, a route at a viewport, a component
mounted in a test. Which reading you need depends on the decision, not on what
renders those subjects.

| The decision in front of you | What answers it | Command |
| --- | --- | --- |
| Which test files can this diff not have reached? | The recorded execution journal, checked against the diff | `variance select --since origin/main` |
| Which subjects are worth rendering this run? | Source reach, what each subject was last seen rendering, and the [execution index](execution-record.md) | `variance run --since origin/main` |
| What changed, and is it one cause or many? | The completed run report | `variance ask summary`, then `variance ask changes` |
| Is this subject changing, or disagreeing with itself? | Every subject read twice in the same run | `variance run --flakes` |
| What is this test actually exercising? | Attention markers joined to the source that execution entered | `variance distill --test <id>` |

`select` is the one written for a runner this tool never enters — a plain
`vitest`, a `jest`, a CI shell script. It emits a skip list of test files and
never a run list: a test the journal has never recorded is absent from it and
stays in the suite. It reads no project configuration, and with no recording it
skips nothing and says so on stderr.

`run --flakes` reads every subject twice instead of only the ones a comparison
already called `changed`, and exits `1` even when every verdict is green.

A first pass through the loop is three commands:

```bash
variance run --since origin/main
variance ask summary
variance ask changes
```

`variance ask` with no question prints every question the last run and a live
watcher can answer, and the arguments each takes.

## The loop behind those commands

**Name the outcome → frame the variance → choose an eye and a [vantage](vantage.md) → sense
or instrument → read the evidence → act or step back.**

The path can be short. One reading may answer the question. It can also reveal
a better question or show that another point of observation is needed.

## Why — name the outcome

The outcome is the decision or action the work must support: which tests to
run, whether a change is authorized, where two executions parted, what an
interface communicates, or whether an agent knows enough to edit a file.

Naming it separates useful work from work that merely happens to be available.
“Compare every screenshot” may become “find the subjects this edit could
affect.” “Approve this image” may become “explain the cause shared by these
changes.” The more precise question usually needs less machinery.

## How — sense what remains; instrument what disappears

Some evidence already exists in source, artifacts, retained history, or a
running system. Read it where it is. Other evidence disappears with the
process that produced it. Instrument that moment and retain the answer.

Neither mode is inherently better. The question decides whether a source
index, a browser observer, an execution trace, a comparison, or an existing
external system should answer it. [Instruments](instruments.md) names the
reading behind each product claim and where it stops.

## What — choose an eye and a vantage

An **eye** is the capability that can make the relevant distinction: source
reach, accessibility, component [provenance](attribution.md), pixels, runtime work, presentation
relationships, or another observation. A **vantage** is where and under which
conditions that eye reads: committed source, a live page, one execution, two
runs, or retained history.

[Eyes](eyes.md) shows how a test's attention reads the React tree.
[Vantage](vantage.md) shows what a live or unfinished run can reveal. They are
examples of the choice, not mandatory stages. The same eye from another vantage
may answer a different question; the same vantage with another eye may expose a
different kind of variance.

## Result — make the decision the evidence supports

Evidence supports only the question it answered. It may help approve a change,
select work, attribute a cause, guide an investigation, or show that another
observation is needed. The result names its subject, conditions, provenance,
and boundary so the next person can understand why it is useful.

The goal is enough confidence for one defensible decision, with no claim about
the parts of the codebase that were not observed.
[Information model](information.md) defines how the question and its boundaries
survive in retained evidence. [Metrics](metrics.md) defines the population and
denominator behind every measured claim.

## When the evidence stops, choose the next question

An unavailable reading is absent, never an empty result. A first observation is
`new`, not unchanged. Evidence produced under incompatible conditions is
`incomparable`, not different. A capability that did not observe a band reports
it as unobserved rather than silently clearing it.

When the evidence cannot support the intended decision, the next step is one of:

- narrow the claim to what was observed;
- widen the observation;
- choose another eye or vantage;
- ask the person or system that owns the missing decision; or
- leave the conclusion open.

An open conclusion is still useful when it names what is missing. It keeps the
current answer trustworthy and turns the missing observation into the next
explicit question.
