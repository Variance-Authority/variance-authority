# Spec 0041 — orientation is the first five minutes

**Missing:** the accepted numbers, the scale the index is for, and the page
that owns search. The lexicon is written by every run and queried by
`variance_locate`, and what it has never been is *held to a standard*: there is
no precision and recall a person agreed to in advance, no measurement on a
suite where product words repeat, no figure for what the index costs at twenty
thousand subjects, and no measurement of what a start point removes. The
representation exists; the claim that it orients anybody does not.
**Built on:** [0039](0039-a-subject-is-found-from-a-description.md) (the search
itself, and the corpus this measures on),
[0042](0042-a-start-point-is-a-path-sense-holds.md) (the start point, which is
the only thing that makes the ranking tractable at scale),
[ADR-0057](../context/adr/0057-the-run-writes-every-name-it-saw.md) (the run
writes every name it saw).

## Purpose

Semantic search asks *which source code sounds like this request*. On an
application of any size that question is answered by every file that shares the
request's vocabulary, which is why re-ranking is where those systems fail: the
words *card*, *row*, *status* and *submit* are said by hundreds of places that
have nothing to do with each other.

The lexicon asks a different question — *what product surfaces does this source
code actually produce* — and indexes the answer. A run renders the suite, reads
each rendering, and writes down what a person would have seen: the names,
the visible text, the handles, the roles, and what encloses what. A description
of a surface then lands on the surfaces, because both sides are in the same
vocabulary.

The capability this spec exists for is the first five minutes of a task:
somebody holds a sentence about a product surface — *the tax line under the
delivery address on the checkout page* — and needs the file. Not a ranked list
of plausible modules. The file, and the line if the build kept one.

Two consequences follow, and both are requirements rather than embellishments.
The lexicon **owns search and retrieval** as a product: what it indexes, how a
person turns it on, what they may ask, and what it refuses. And it is an
**artifact**, not a service — a run produces it, and an agent on another machine
reads it without rendering anything.

## What would discharge it

**1. A precision and recall somebody accepted before it was measured.** The
corpus is [0039](0039-a-subject-is-found-from-a-description.md) item 1 — a
generated suite of a few hundred subjects where product words repeat and every
relation question has a decoy. What this spec adds is the gate: first-hit and
within-three as integer counts against a fixed denominator, agreed before the
run, and a refusal count that must equal the number of questions with no answer
exactly. A measurement whose target is set afterwards measures nothing.

Fifteen subjects is not that suite. On todomvc the summary an agent already
reads scores 20 of 20 by scanning, so every number the tool has produced so far
is a number a reader could have got without it.

**2. The size of the index, at the size it is for.** The suites this is for are
twenty thousand stories over millions of lines, held by many teams. The
measurement owed is bytes: per subject, and in total, at 300 / 2,000 / 20,000 /
100,000 subjects, with the distribution drawn from a real lexicon and validated
against it. A design system of forty components indexes differently from an
application of four hundred pages, and only the second shape answers the
question.

A ceiling belongs in this spec because the index is downloaded. Tens of
megabytes for a large application is the order that has been seen and is
acceptable; hundreds is not, and the difference decides whether landmarks are
written for every subject or for the subjects that earn them. The scale script
is barred from answering quality — it measures bytes, build time, query time
and resident memory, and nothing else.

**3. What the start point removes, as a count.** The argument for
[0042](0042-a-start-point-is-a-path-sense-holds.md) is that scoping to the files
reachable from one entry point cuts the candidate set by an order of magnitude
and makes ranking easy. That is a within-run share and can be gated: candidate
subjects before the start point and after it, on the same question, in the same
run. Nothing here may be a ratio of two timed runs.

The same measurement has a second half that matters more: whether the answers
improve. First-hit over the scoped half of the question set, against the same
questions asked unscoped, on a corpus where the same words are said in several
places.

**4. The page that owns it.** Somebody who wants to search their suite should
find one page that says what the lexicon is, what it can answer, how to produce
it, and how to ask — written for the person with the question, not for the
person maintaining the indexer. Field lists, tokenisers and rarity arithmetic
are the appendix, not the opening. [`lexicon.md`](../lexicon.md) is that page
and is still written from the inside out in places.

**5. The index without a run in front of it.** An agent is expected to download
the index a master build produced and ask questions of it, on a machine that
renders nothing. Today the tools answer from a run report, which is the same
file by another name in the easy case and not the same thing at all when the
question is asked against a build somebody else made. What is owed is the
boundary: what a reader may ask of an index alone, and what genuinely needs the
run.

## What this spec does not claim

**It does not replace semantic search.** Platform code with no product surface —
a scheduler, a serializer, a build plugin — produces no landmarks and is
invisible here, and that is correct rather than a gap. The lexicon is better
suited where a request is phrased in product words and the code is reached
through a screen. Saying otherwise would be a claim the corpus contradicts on
its first platform question.

**It does not rank by meaning.** Nothing here embeds anything. The ranking is
over words a run observed, and the first thing a reader must be able to predict
is *why* a hit is a hit, which an embedding cannot tell them.
