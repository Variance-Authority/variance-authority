# Spec 0042 — a start point is a path sense holds

**Missing:** the authority and the closure. The grammar landed — three widths,
anchored at the root, whole segments, case included, every fuzzy rule removed —
and it is pointed at the wrong thing. A path is tested against the file paths
the *report* recorded, so most of a real tree answers *not found* and a path the
run wrote but the tree does not have answers *found*. And a path that resolves
narrows to the subjects whose own files matched, not to what is reachable from
it, which is the entire reason a start point exists.
**Built on:** [0025](0025-component-relations.md) (the file graph this walks),
[0041](0041-orientation-is-the-first-five-minutes.md) (why a start point exists
at all), [0039](0039-a-subject-is-found-from-a-description.md) (the search it
narrows).

## Purpose

Most requests belong to a domain, and a domain is not always a directory — but
it always has a **start**: a route, a page, a canonical example. Scoping the
suite to what is reachable from that start cuts the candidate set by an order of
magnitude and turns ranking into a small problem instead of a re-ranking
problem.

So `from` takes a concrete file, or concrete files, and answers only from files
physically reachable from that location. Exact and deterministic. No fluidity is
accepted: a reader may search for *something that looks like a duck*, but when
they say *only in this pond*, the pond is a hard rule.

## The rule, in full, because it keeps being loosened

**A path exists or it does not.** Read from the root down, compared segment for
whole segment, case included. Nothing is looked for *inside* a path. Three
widths:

| written | means |
|---|---|
| `app/checkout/page.tsx` | that file |
| `app/checkout/*` | that folder's own files, one level |
| `app/checkout/` | everything underneath, at any depth |

A `*` anywhere but the last segment is a pattern, and a pattern is not a path.
Every inference is forbidden — sliding, tails, suffixes, case folding,
extension stripping, stemming, reading one path as another because one ends
with it, treating a bare filename as the file of that name wherever it lives,
and offering the reader two candidate places. `Badge.tsx` is a file at the root;
where no such file is at the root the start point is **not found**.

**One failure mode, and it is a rejection.** A start point that does not resolve
is refused, and the question is not quietly answered suite-wide instead. An
empty answer inside a scope and a scope that does not exist are different
sentences.

**Several paths are several entry points, unioned.** This spec decides that, and
says so rather than pretending it was handed down: two entry points have very
nearly no files in common, so intersecting answers nothing exactly when the
caller was most specific. [`locate.md`](../locate.md) currently publishes the
opposite — *keeps only subjects seen in a file at both* — which matches neither
this spec nor the code, and is the first thing to go.

## Where a path is resolved

**Sense, and nothing else.** Sense is a machine and works one way: tree
traversal. Leaves and branches exist or they do not. It cannot invent a file, it
cannot invent a relation, it cannot return a false positive or a true negative.

No other source may resolve a start point: not the file paths an observation
recorded, not subject ids, component names, region names or the creator chain.
Those are things a run saw. A path is a fact about a tree, and asking a run's
notes whether a file exists answers a similar-looking different question — and
answers it wrongly in both directions. Today `scopeOf` filters the report's
recorded `files` entries, so every real file the run did not render is *not
found*, and a build-host path or a since-deleted file the run happened to write
down is *found*.

## What is in scope once it resolves

The path selects **entry points**. The module graph decides the scope.

A file is in scope when it is connected to an entry point in the import graph:
reachable from it along the arrows, or reaching it against them, **at any
depth**. Ancestors and descendants, unioned. Anything in neither closure is
hard rejected — not ranked low, not in the answer. A subject is in scope when a
file in scope produced it.

**The walk is not allowed to be bounded for cost.** A depth cap makes the answer
a lower bound, and a lower bound silently loses files that genuinely are
reachable — a true negative, which is the one thing a mechanical index may never
produce. Where the closure cannot be computed, the start point is refused. It is
never under-answered.

Where a file record carries an `unknown` — a specifier the scanner could not
resolve — the complement cannot be proven unreachable, so the answer says so and
counts them. Unresolved is widened toward, never dropped on.

## Decided here, so it stops being reopened

- **Case is part of the path.** Case folding is forbidden, so a path that
  differs in case does not exist. Nothing to settle.
- **A real file that produced no subject resolves.** Sense holds it, so the
  start point is found and the answer inside it is empty. That is a different
  sentence from *not found*, and today's code cannot tell them apart because
  both take the same branch.
- **An absolute path is normalized against the root and then is the same
  question.** Under the root it becomes the repo-relative path sense holds;
  outside it, it is not found. Matching an absolute path because the run
  recorded it absolutely is a coincidence, and it goes.
- **`/` is the separator.** Sense's coordinates are repo-relative with forward
  slashes; a backslash is a character in a name, not a separator. Reading
  `src\billing\Card.tsx` as a path is one more inference.

## What would discharge it

**1. Sense in the query path.** The pattern exists — `relationsFor` in
`packages/cli/src/commands/resources.ts` opens the persistent source index,
scans, and builds the relations. A query needs two things from it: a file list
to test existence against, and a graph to walk. Dynamically imported, with an
explicit refusal when the package is absent, on the model of every other
optional dependency here.

**2. A root, and a channel to carry it.** `variance-authority-mcp
<report.json>` receives one positional argument, `RunReport` names no tree, and
`Tool.run` is handed the report and nothing else — so even the CLI, which has a
working directory, has no way to pass one. Either the run records the root and
the graph it scanned, or the server takes it. The first is better: it removes a
scan from the reader's latency and makes the index answerable on a machine that
holds no source at all ([0041](0041-orientation-is-the-first-five-minutes.md)
item 8). It also has a price — a scan of this repository is 1,164 files and
2,738 edges in about 200 KB of graph, roughly 170 bytes a file, which at the
target size is tens of megabytes beside the lexicon.

**3. Ancestors, affordably.** Descendants are a walk along edges already
recorded. Ancestors are not: answering *what reaches this file* means holding
the whole graph, which is the cost a start point exists to avoid. A reverse
index written once per scan is the way out, and under the rule above it is not
optional — without it the only honest alternatives are holding everything or
refusing.

**4. The ordering, settled by measurement.** Three arrangements, and they are
not equivalent: resolve the reachable set first and search inside it; search
first and re-scope the results, which can lose an answer that never ranked; or
check reachability only for the results found, which is cheap and cannot report
how much it removed. The middle one is disqualified by the rule above. Between
the other two the question is cost, and the shape of the cheap answer is a
staged resolution — ask sense for the entry points' own files, answer, and keep
the frontier for the next question rather than expanding the whole closure for
a reader who asked once.

**5. Tests that pin the rule.** Every test in `scope.test.ts` passes with the
authority wrong, because every fixture builds paths out of subjects. Three of
them encode the defect as the contract — a start point refused because *this
run* holds no file at it, an absolute path resolving because the run recorded it
absolutely — and go with it. What is owed is a test that a real file with no
subject resolves, a test that a recorded path with no file is refused, and the
reachability tests, which do not exist at all.
