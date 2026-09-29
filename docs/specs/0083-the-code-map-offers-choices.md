# Spec 0083 — the code map offers choices

**Missing:** a question about unfamiliar code has no bounded inventory of
places to inspect. The code map publishes areas, packages and imports;
`search` finds names the repository writes. Neither assembles the candidates
for independent relevance judgments. A model cannot recover a useful place
that the producer omitted.
**Built on:** the code map published by `variance index`, the source index's
file and declaration records, [ADR-0069](../context/adr/0069-every-answer-has-an-owner.md)
(the map and index own structural facts), and
[spec 0084](0084-independent-judgments-orient-the-code-map.md) (the consumer of these candidates).

## Purpose

An agent has a task in words and needs the code worth reading. The producer
turns published orientation data into a bounded, addressable candidate set.
Code constructs every candidate and its relation to the others; a decision
model judges only their relevance. It does not name a package, file or edge of
its own.

Candidate production carries the recall risk. A useful place omitted before
scoring is an answer the model cannot give. The producer therefore measures
which indexed places it could offer, including descendants whose parent has
not yet been selected.

## Candidate contract

One candidate has a stable ID, index generation, kind, destination ID, parent
ID when applicable, and owner-provided evidence for its relevance to the task.
The inventory names its starts and the scope it covers. Candidates include:

- root areas, their child areas, and packages beneath them;
- files and declarations indexed under a package;
- both directions of a recorded import, with its source and destination;
- indexed `search` and `symbol` hits in a named scope.

The map or source index supplies every destination and relation. An unresolved
import is unknown, not an edge to a guessed package. A file absent from the
index is not presented as indexed. Question time reads the published artifacts,
not source text, manifests or a test run. `orient` remains a reader of files it
is given; this producer is a separate consumer of its graph.

The root map is a start when the task gives no file. A file supplied by the
editor, trace or user starts at its owning package. Indexed lexical hits add
starts; they do not remove root-map starts merely because the task uses words
the repository does not. Each start says which owner supplied it.

## Shared state and speculative candidates

The producer exposes a bounded map slice that can contain root areas, children
of every root, and package summaries under those children in one state. Each
candidate retains its parent and the premise under which it matters: a child
can be judged for relevance *if its parent is explored* before the parent has
been selected. The consumer can discard that judgment when the premise does
not hold. It does not need another model request merely to reveal an already
indexed child.

The slice declares its depth, covered parents, omitted descendants, token
size and index generation. If the whole inventory does not fit the runtime's
state or question limits, deterministic partitioning covers it in additional
batches. It never silently takes the first N, a popularity shortlist or a
model-ranked subset and calls that the whole map. A budget that prevents
scoring every partition names the unscored scope and makes the answer
incomplete. This contract does not require the entire repository in one
request; it requires every serial request to have a stated evidence or
capacity reason.

The same candidate IDs can be rendered through two evidence views:

1. **Name and place:** area and package names, directory, file and declaration
   names, and published descriptions when present.
2. **Relation:** import direction and named imports, the packages at the two
   ends, dependency layer and recorded cases when present.

A view omits evidence the owner did not provide. It does not fill a missing
description with generated prose or a missing recording with zero cases. The
producer states the source and age of every artifact used. Two views of the
same slice retain identical candidate IDs, parent relations and coverage, so
disagreement is about evidence rather than different candidates.

## What would discharge it

1. A versioned candidate and shared-state format with no model dependency.
   A fixture enumerates every indexed area, package, file, declaration and
   import; deterministic partitioning loses none.
2. Start fixtures for a question with no path, a known file, and words whose
   lexical search has no hit. The latter still gets root-map candidates.
3. One fixture presents root areas, their children and package summaries
   together, including children of roots later judged irrelevant. Parent IDs
   and premises let the consumer ignore those speculative judgments.
4. Every selected ID resolves to the exact indexed destination; a fabricated
   ID is refused. An index generation change invalidates the candidate before
   it can be used. An absent, stale, incomplete or damaged index is not a
   healthy empty candidate set.
5. Measure candidate recall on held-out tasks using each task's pre-change
   index: does the covered inventory include a route to each reviewed target
   area, package and file within the stated state and question budgets? Count
   omissions by start, area, package, edge, file and capacity. Model scores do
   not enter this measure.

The producer is complete when every legal indexed route can be offered and
the measurement says where an unindexed or capacity-limited route stops. That
is a structural claim, not a claim that a model will judge it correctly.
