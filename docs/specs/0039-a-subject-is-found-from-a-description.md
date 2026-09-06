# Spec 0039 — a subject is found from a description

**Missing:** the suite where it matters, and four fields. The lexicon and the
structure rows reach the report, `variance_locate` ranks over them and
`variance_composition {subject}` prints them, and the only measurement is on
fifteen subjects, where the summary an agent already reads scores 20 of 20 by
scanning. Nothing measures the tool where the summary does not fit in one
answer. The lexicon carries no story file or line, no state keys, no
co-occurrence, and the recall prints rows rather than the tree.
**Built on:** [ADR-0057](../context/adr/0057-the-run-writes-every-name-it-saw.md)
(the run writes every name; order is orientation),
[ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md) (the
regions a subject entered are places, and the lexicon's `regions` field is a
reader of them), [ADR-0035](../context/adr/0035-a-node-stands-in-every-component-above-it.md)
(what a boundary is), [0038](0038-a-journey-is-read-against-the-committed-tree.md)
(the name `anon#n` that this cannot find either).

## Purpose

An agent that holds a description and needs a subject id should get one from
the run, with the fact under the order printed, on a suite of any size. An
agent that holds a subject id should get what the subject is made of without
re-rendering it. Both exist. What is missing is the proof that the first earns
its place, and the fields that would let a description reach what the run does
not yet write down.

## What would discharge it

**1. The suite where the summary does not fit.** A generated plan of a few
hundred subjects beside todomvc — a design system of forty components and the
pages that mount them, with names drawn from a fixed list so the measurement
is the same bytes every run — and the twenty-questions file run against it.
The claim to gate on is a count: first-hit and within-three over the questions,
and refusals over the questions with no answer, each an integer against a
fixed denominator. No ratio of timed runs anywhere in it.

**2. The story's own file and line.** The run does not hold `stories.tsx`, and
the render already carries what the props became, so the story source is not
indexed. What the plan does hold is where each subject was declared, and a
`declared` field — file and line of the subject's own declaration, as the
source index already holds it for components — would let `variance_locate
{query: "stories.tsx:41"}` answer. Derived from the plan, never parsed from a
story body.

**3. State keys.** The semantic snapshot carries `pressed`, `checked`,
`expanded` as keys with values. The keys are vocabulary a person uses — *the
pressed chip* — and the values are state. A `states` field holding the keys a
subject's nodes carry, never the values, is one more column in the fold.

**4. Full-tree recall.** The rows fold on component, depth, enclosing boundary
and creator, which loses which of the three `TodoItem` rows the second
`Toggle` sits under when the counts disagree. A tree — each row carrying its
parent row — is one more integer per row and no more digests, and it prints
as an indented tree rather than an indented list. Taken only if a reader
needs the parent, because the flat rows are what the report can carry at
three hundred subjects.

**5. Co-occurrence, printed.** Terms that share subjects can expand a query —
`filter` reaching `chip` and `pressed` because the three occur together. On
fifteen subjects it is noise; on three hundred it is a signal. Ranked under
exact hits, never applied to a term that occurs nowhere, and printed on the
answer as the expansion it is, so a hit through it is still a fact the reader
can check. Taken only after item 1 shows the exact hits fall short.

## What it forecloses

**A float in a sort key, a synonym table, a model.** ADR-0057 rules them out,
and nothing here reopens them: co-occurrence is counted, not weighted.

**Indexing `anon#n`.** A region named by ordinal matches nothing anyone
types, and spec 0038 owns the name.

**A run id on the lexicon.** The suite in item 1 is one run compared to
itself; nothing joins its names to another run's.
