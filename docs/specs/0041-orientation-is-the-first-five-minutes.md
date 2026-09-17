# Spec 0041 — orientation is the first five minutes

**Missing:** the numbers, the scale, the de-noising, and the page that owns
search. The lexicon is written by every run and queried by `variance_locate`,
and it has never been held to a standard: no precision and recall anybody agreed
to in advance, no measurement on a suite where product words repeat, no figure
for what the index costs at twenty million lines, nothing that removes the
transitive components a real tree is mostly made of, no hop count from a
component to the nearest example that mounts it, and no measurement of what a
start point removes. The representation exists; the claim that it orients
anybody does not.
**Built on:** [0039](0039-a-subject-is-found-from-a-description.md) (the search
itself, and the corpus this measures on),
[0042](0042-a-start-point-is-a-path-sense-holds.md) (the start point, which is
the only thing that makes ranking tractable at scale),
[ADR-0057](../context/adr/0057-the-run-writes-every-name-it-saw.md) (the run
writes every name it saw).

## Purpose

Semantic search asks *which source code sounds like this request*, and on an
application of any size that question is answered by every file sharing the
request's vocabulary. The lexicon asks a different question — *what product
surfaces does this source code actually produce* — and indexes the answer, so a
description of a surface lands on surfaces because both sides are in the same
vocabulary.

The capability is the first five minutes of a task: somebody holds a sentence
about a product surface — *the tax line under the delivery address on the
checkout page* — and needs the file. Not a ranked list of plausible modules.

Two consequences, both requirements. The lexicon **owns search and retrieval**
as a product: what it indexes, how a person turns it on, what they may ask, what
it refuses. And it is an **artifact** — a run produces it and an agent on
another machine reads it without rendering anything.

## What would discharge it

**1. A precision and recall somebody accepted before it was measured.** The
corpus is [0039](0039-a-subject-is-found-from-a-description.md) item 1 — a
generated suite of a few hundred subjects where product words repeat and every
relation question carries a decoy. What this spec adds is the gate, and three
numbers rather than two:

- **Precision at the top**: first-hit, and within-three, as integer counts
  against a fixed denominator.
- **Recall**: over the questions that *have* an answer in the corpus, the share
  where the right subject appears anywhere in what the tool returned, at the
  limit a caller actually gets. A tool that never puts the answer first but
  always carries it is a different failure from one that loses it, and
  first-hit alone cannot tell them apart.
- **Refusals**: the count must equal the number of questions with no answer,
  exactly.

All three agreed before the run. A measurement whose target is set afterwards
measures nothing, and fifteen subjects is not that suite: on todomvc the summary
an agent already reads scores 20 of 20 by scanning, so every number this tool
has produced so far is a number a reader could have got without it.

**2. What the index costs at the size it is for.** Twenty million lines, twenty
thousand stories, many teams. The measurement owed is bytes — per subject and
in total — with build time, query time and resident memory beside them, at
300 / 2,000 / 20,000 / 100,000 subjects, and stated against a line count as
well as a subject count, because the question asked was about a 20 MLOC
repository and a subject count does not answer it. The distribution must be
drawn from a real lexicon and validated against it: a design system of forty
components indexes differently from an application of four hundred pages.

Cost is not the constraint on what gets built. Tens of megabytes for a large
application is the order already seen and is acceptable; it can be more. The
measurement exists so the number is known and can be argued with, not so it can
be used to quietly stop writing things down.

**3. What the start point removes, as a count.** Scoping to the files reachable
from one entry point is claimed to cut the candidate set by an order of
magnitude ([0042](0042-a-start-point-is-a-path-sense-holds.md)). That is a
within-run share and can be gated: candidate subjects before the start point and
after it, on the same question, in the same run. No ratio of two timed runs
anywhere in it.

The half that matters more is whether the answers improve: first-hit over the
scoped questions, against the same questions asked unscoped, on a corpus where
the same words are said in several places.

**4. The noise a real tree is made of.** An application's fiber tree runs six
hundred deep and most of it is not a product surface: context providers and
consumers, HOC-era wrappers, class components that render one child, empty
spans. Indexing them buys nothing and costs every reader precision. What is
owed is the rule for what is written down, and a measurement in counts — frames
walked, boundaries attributed, inert wrappers collapsed — on a tree with real
depth rather than a fixture with none.

**5. The distance to the nearest example.** An agent that lands on a component
needs to know where it can be *seen*, which is the nearest component above it
that an example mounts, and how many hops away that is. The walk is up the
creator chain until a component with examples; the measurement on one large
application says roughly a quarter of components are themselves examples,
another quarter are one hop up, and at the nearest rung the answer is a single
component about three quarters of the time. That is worth printing beside a hit
and is printed nowhere.

**6. Relation questions without reading every surface.** *A under B* is asked of
the whole suite, and the exact answer is a walk over one surface's landmarks.
The preselection owed is co-existence: which surfaces say both words at all,
answered from a per-subject filter before any of them is read, then the
relation resolved only on the survivors. A filter over a subject's own words
exists; a filter that answers *both, together* over a composition does not, and
that is what decides whether twenty thousand surfaces can be asked a spatial
question.

**7. The page that owns it.** Somebody who wants to search their suite should
find one page that says what the lexicon is, what it can answer, how to produce
it, and how to ask. [`lexicon.md`](../lexicon.md) opens on the index rather than
on the reader and must be rewritten for the person with the question. Field
lists, tokenisers and rarity arithmetic are the appendix.

**8. The index without a run in front of it.** An agent is expected to download
what a master build produced and ask questions of it on a machine that renders
nothing. Today the tools answer from a run report — the same file by another
name in the easy case, and not the same thing at all when the question is asked
against a build somebody else made. What is owed is the boundary: what a reader
may ask of an index alone, and what genuinely needs the run.

## What this spec does not claim

**It does not replace semantic search.** Platform code with no product surface —
a scheduler, a serializer, a build plugin — produces no landmarks and is
invisible here. The lexicon is better suited where a request is phrased in
product words and the code is reached through a screen, and saying more than
that is a claim the corpus contradicts on its first platform question.

**It is not the only retrieval surface.** Exact search over documentation and
API comments is a third surface, alongside semantic search over the codebase and
this one over what the suite renders. It is not built here and this spec does
not absorb it.

**It does not rank by meaning.** Nothing embeds anything. The ranking is over
words a run observed, and a reader must be able to predict *why* a hit is a hit.
