# Follow the reasoning loop

Before running another tool, name the decision you are trying to make. The
useful evidence for choosing tests is different from the evidence for explaining
a visual change or understanding a stalled run. Starting with the decision keeps
the investigation focused and makes it easier to see when the available
evidence is enough.

The shared loop is:

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

[Eyes](eyes.md) shows how a test's attention reaches the React tree.
[Vantage](vantage.md) shows what a live or unfinished run can reveal. They are
examples of the choice, not mandatory stages. The same eye from another vantage
may answer a different question; the same vantage with another eye may expose a
different kind of variance.

## Result — make the decision the evidence supports

Evidence supports only the question it answered. It may help approve a change,
select work, attribute a cause, guide an investigation, or show that another
observation is needed. The result carries its subject, conditions, provenance,
and boundary so the next person can understand why it is useful.

The goal is enough confidence for one defensible move, with no claim about the
parts of the codebase that were not observed.
[Information model](information.md) defines how the question and its boundaries
survive in retained evidence. [Metrics](metrics.md) defines the population and
denominator behind every measured claim.

## When the evidence stops, choose the next question

An unavailable reading is absent, never an empty result. A first observation is
`new`, not unchanged. Evidence produced under incompatible conditions is
`incomparable`, not different. A capability that did not observe a band reports
it as unobserved rather than silently clearing it.

When the evidence cannot carry the intended decision, the next move is one of:

- narrow the claim to what was observed;
- widen the observation;
- choose another eye or vantage;
- ask the person or system that owns the missing decision; or
- leave the conclusion open.

An open conclusion is still useful when it names what is missing. It keeps the
current answer trustworthy and turns the missing observation into the next
explicit question.
