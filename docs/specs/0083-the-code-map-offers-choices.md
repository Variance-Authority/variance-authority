# Spec 0083 — the code map offers choices

**Missing:** a question about unfamiliar code has no bounded set of places to
inspect. The code map publishes areas, packages and their import relationships;
`search` finds names the repository writes. Neither produces the legal options
for a decision model to choose among. A model cannot recover a useful place
that the option producer omitted.
**Built on:** the code map published by `variance index`, the source index's
file and declaration records, [ADR-0069](../context/adr/0069-every-answer-has-an-owner.md)
(the map and index own structural facts), and
[spec 0084](0084-a-decision-walks-the-code-map.md) (the consumer of these menus).

## Purpose

An agent has a task in words and needs the code worth reading. The option
producer turns a published code map into a series of small, complete menus. A
decision model chooses among those options. It does not name a package, file or
edge of its own.

The option producer is the load-bearing part of this capability. A model's
accuracy is conditional on the right route appearing in a menu. An option
omitted before scoring is an answer the model cannot give.

## Menu contract

One menu names the index generation, its current area, package or file, one
direction, and the page of legal actions at that location. An action has a
stable ID, destination ID, kind, and the evidence that the published index
already gives for that move. The `none of these` option belongs to every
scored page. It means only that the presented actions are unpromising.

The producer makes these actions, as applicable:

- open a child area or one of the packages at an area leaf;
- inspect a file or declaration indexed under the current package;
- follow a recorded import from this package to one it uses;
- follow a recorded incoming import to a package that uses this package;
- inspect a name found by indexed `search` or `symbol` under the current scope.

The map or source index supplies every destination and every relation. An
unresolved import is unknown, not an edge to a guessed package. A file absent
from the index is not presented as indexed. Question time reads the published
artifacts, not source text, manifests or a test run. `orient` remains a reader
of files it is given; this producer is a separate consumer of its graph.

The root map page is a start when the task gives no file. A file supplied by the
editor, trace or user starts at its owning package. Indexed lexical hits add
starts; they do not remove root-map starts merely because the task uses words
the repository does not. Each start says which owner supplied it.

## Pages and evidence

Each scored menu fits the decision model's declared option and token limits.
The producer pages a node with more legal actions than one menu can present.
It never silently takes the first N, a popularity shortlist or a model-ranked
subset and calls that the whole node. `None` on one page cannot close a node
while another page remains unread. A budget that prevents reading every page
names the pages left and makes the answer incomplete.

The same action IDs are rendered through two views of the evidence:

1. **Name and place:** area and package names, directory, file and declaration
   names, and published descriptions when present.
2. **Relation:** import direction and named imports, the packages at the two
   ends, dependency layer and recorded cases when present.

A view omits evidence the owner did not provide. It does not fill a missing
description with generated prose or a missing recording with zero cases. The
producer states the source and age of every artifact used. Rendering the two
views must leave the IDs, destinations and `none` identical, so disagreement is
about evidence rather than different option sets.

## What would discharge it

1. A versioned menu format and a producer over the published code map and
   source index, with no model dependency. A fixture enumerates every area,
   package, file and import action and proves that pagination loses none.
2. Start fixtures for a question with no path, a known file, and words whose
   lexical search has no hit. The latter still gets root-map options.
3. A menu round trip in which every selected ID resolves to the exact indexed
   destination and a fabricated ID is refused. An index generation change
   invalidates the menu before an action can be applied.
4. Refusals for an absent, stale, incomplete or damaged index. None is reported
   as a healthy empty menu. An unresolved edge and a missing test recording
   remain visibly unknown.
5. A measured option-set recall on held-out tasks: from each task's pre-change
   index, does some presented route lead to every reviewed target area, package
   and file within the stated page budget? Count omissions by the stage that
   lost them: start, area, package, edge or file. Model scores do not enter this
   measure.

The producer is complete when every legal indexed route can be presented and
the measurement says where an unindexed or budget-limited route stops. That is
a structural claim, not a claim that a model will choose the right route.
