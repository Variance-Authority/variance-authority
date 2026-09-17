# Spec 0042 — a start point is a path sense holds

**Missing:** the authority and the closure. The grammar landed — a start point
is a path, three widths, no fuzzy matching of any kind — but it is resolved
against the file paths the *report* recorded, which is the wrong source, and a
path that resolves narrows to the subjects whose own files it matched rather
than to everything reachable from it. Both halves of the actual rule are absent:
sense decides whether a path exists, and the module graph decides what is in
scope.
**Built on:** [0025](0025-component-relations.md) (the file graph this walks),
[0041](0041-orientation-is-the-first-five-minutes.md) (why a start point exists
at all), [0039](0039-a-subject-is-found-from-a-description.md) (the search it
narrows).

## Purpose

Most requests belong to a domain, and a domain is not always a directory — but
it always has a **start**: a route, a page, a canonical example. Scoping the
suite to what is reachable from that start cuts the candidate set by an order of
magnitude and makes ranking a small problem instead of a re-ranking problem.

So `from` takes a concrete file, or concrete files, and answers only from files
physically reachable from that location. It is exact and deterministic. No
fluidity is accepted: a reader may search for *something that looks like a
duck*, but when they say *only in this pond*, the pond is a hard rule.

## The rule

**A path exists or it does not.** That is the whole test. A path is read from
the root down and compared segment for whole segment, case included. Nothing is
looked for *inside* a path.

Three widths, and no others:

| written | means |
|---|---|
| `app/checkout/page.tsx` | that file |
| `app/checkout/*` | that folder's own files, one level |
| `app/checkout/` | everything underneath, at any depth |

A `*` anywhere but the last segment is a pattern, and a pattern is not a path.

Every one of these is forbidden, and each has been implemented here at least
once and removed: sliding a term along a path, matching a tail or a suffix,
folding case, stripping an extension, stemming a segment, reading one recorded
path as another because one ends with the other, treating a bare filename as the
file of that name wherever it lives, and offering the reader two candidate
places to choose between. `Badge.tsx` is a file at the root. Where no such file
is at the root, the start point is **not found** — not disambiguated, not
guessed, not widened.

**There is one failure mode, and it is a rejection.** A start point that does
not resolve is refused as not found, and the question is not answered suite-wide
instead. An empty answer inside a scope and a scope that does not exist are
different sentences and a reader acts on them differently.

**Several paths are several entry points**, taken together. They are not
intersected: a settings page and an invite modal have very nearly no files in
common, so intersecting would answer nothing exactly when the caller was most
specific.

## Where a path is resolved

**Sense, and nothing else.** Sense is a machine and works one way: it is tree
traversal. Leaves and branches exist or they do not. It cannot invent a file, it
cannot invent a relation, it cannot return a false positive or a true negative.
A path put to it comes back as a file it holds or as nothing.

No other source may resolve a start point. Not the file paths an observation
recorded, not subject ids, not component names, not region names, not the
creator chain. Those are things a run saw; a path is a fact about a tree, and
asking a run's notes whether a file exists answers a different question that
happens to look similar — and answers it wrongly on the first file the run did
not happen to render.

This is where the implementation is wrong today. `scopeOf` filters the report's
recorded `files` entries. It gives the right answer for a file a subject was
seen in and the wrong answer — *not found* — for every other real file in the
tree, which is most of them.

## What is in scope once it resolves

The path selects **entry points**. The module graph decides the scope.

A file is in scope when it is connected to an entry point in the import graph:
reachable from it along the arrows, or reaching it against them, at any depth.
Ancestors and descendants, unioned. Anything in neither closure is **hard
rejected** — it is not ranked low, it is not in the answer.

A subject is in scope when a file in scope produced it.

That is the part that makes a start point worth having. Narrowing to the files
*under* a directory answers a question about the filesystem; narrowing to the
files a page can actually reach answers the question the reader asked, and picks
up the shared component three packages away that the page renders.

## What would discharge it

**1. Sense wired into the query path.** The pattern exists —
`relationsFor` in `packages/cli/src/commands/resources.ts` opens the persistent
source index, scans, and builds `Relations`. What a query needs from it is a
file list to test existence against and a graph to walk. Dynamically imported,
with an explicit refusal when the package is absent, on the model of every other
optional dependency here.

**2. A root.** `variance-authority-mcp <report.json>` receives a path to a file
and nothing else, and no field on `RunReport` says which tree the run read. The
closure cannot be computed without one. Either the run records the root and the
graph it scanned, or the server takes it — and the first is better, because it
also removes the scan from the reader's latency and makes the index answerable
on a machine that holds no source at all ([0041](0041-orientation-is-the-first-five-minutes.md)
item 5).

**3. The closure, at a cost the first five minutes can pay.** Descendants are a
walk along edges already recorded and are cheap. Ancestors are not: without a
persisted reverse index, answering *what reaches this file* means holding the
whole graph, which is the cost the start point exists to avoid. What is owed is
a reverse index written once per scan, and a bound on how far a walk goes before
it answers.

A partial expansion is a **lower bound**, never a complete answer: a file record
may carry an `unknown` — a specifier the scanner could not resolve — so a
truncated walk may be missing files that genuinely are reachable. That is
acceptable for orientation, where a reader is being pointed somewhere, and is
not acceptable for anything that decides what to skip. The two uses must not
share a code path that forgets the difference.

**4. The three questions nobody has settled.**
- **Case.** Held case-sensitive here, which is right on the filesystems this
  runs on and wrong on a case-insensitive one where the same file has two
  spellings. Decide it rather than inherit it.
- **A path that exists and holds nothing.** A real file that produced no
  subject: *resolved, and the answer inside it is empty*, or *not found*? They
  are different sentences and today's code cannot tell them apart.
- **Absolute paths.** A reader's editor hands out absolute paths; a run may
  record either rooting, and one corpus here records both for the same tree.
  Answering an absolute path by matching the string as recorded is what happens
  now, and it is a coincidence rather than a rule.
