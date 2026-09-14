# Follow the reasoning loop

A system can begin with an available operation and ask how much of it to run.
Variance Authority begins one step earlier: what outcome should this work make
possible, and what evidence could support it? The answer determines the
question, the observation, and the boundary of the result.

Every use follows the same grammar:

**Name the outcome → frame the variance → choose an eye and a vantage → sense
or instrument → read the evidence → act or step back.**

The path is recursive, not linear. An answer can expose a better question, and
a missing observation can send the reader to another vantage. The loop may end
after one reading or cross several aspects of the system.

## Why — name the outcome

The outcome is the decision or action the work must support: which tests to
run, whether a change is authorized, where two executions parted, what an
interface communicates, or whether an agent knows enough to edit a file.

Naming it separates useful work from available work. The system does not ask
*what can I run?* until it knows *why should I run it?* A deeper why may change
the question: “compare every screenshot” can become “find the subjects this
edit could affect,” or “approve this image” can become “explain the cause shared
by these changes.”

## How — sense what remains; instrument what disappears

Some evidence already exists in source, artifacts, retained history, or a
running system. Sense it where it is. Other evidence disappears with the
process that produced it. Instrument that moment and retain the answer.

Neither mode is inherently better. The question decides whether a source
index, a browser observer, an execution trace, a comparison, or an existing
external system should answer it. [Instruments](instruments.md) names the
reading behind each product claim and where it stops.

## What — choose an eye and a vantage

An **eye** is the capability that can make the relevant distinction: source
reach, accessibility, component provenance, pixels, runtime work, presentation
relationships, or another observation. A **vantage** is where and under which
conditions that eye reads: committed source, a live page, one execution, two
runs, or retained history.

[Eyes](eyes.md) shows how a test's attention reaches the React tree.
[Vantage](vantage.md) shows what a live or unfinished run can reveal. They are
examples of the choice, not mandatory stages. The same eye from another vantage
may answer a different question; the same vantage with another eye may expose a
different kind of variance.

## Result — earn bounded authority

Evidence earns authority only for the question it answered. It may authorize a
change, select work, attribute a cause, guide an investigation, or support no
conclusion yet. The result carries its subject, conditions, provenance, and
boundary.

Authority is not certainty about the whole codebase. It is the standing to make
one defensible move without pretending to know more than the evidence says.
[Information model](information.md) defines how the question and its boundaries
survive in retained evidence. [Metrics](metrics.md) defines the population and
denominator behind every measured claim.

## Step back before the evidence runs out

An unavailable reading is absent, never an empty result. A first observation is
`new`, not unchanged. Evidence produced under incompatible conditions is
`incomparable`, not different. A capability that did not observe a band reports
it as unobserved rather than silently clearing it.

When the evidence cannot carry the intended decision, the next move is one of:

- narrow the claim to what was observed;
- widen the observation;
- choose another eye or vantage;
- defer to the person or system that owns the missing authority; or
- refuse the conclusion.

Stepping back is part of the method, not a failure of it. It keeps each answer
useful inside its boundary and makes the missing observation the next explicit
question.
