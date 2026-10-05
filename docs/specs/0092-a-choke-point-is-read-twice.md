# Spec 0092 — a choke point is read twice

**Missing:** nothing names the file that every test reaching another file has
to pass through. The field calls that file a **dominator**, and a memory
profiler calls what sits behind it *retained size*. We call it a choke point,
and we read it twice: once from the import graph, which says what has to
happen, and once from the recording, which says what did. Their disagreement
is the finding.
**Built on:** `scanRelations` in `@variance-authority/sense` and the
`Relations` that `@variance-authority/core/relate` builds from its records
(runtime edges through `RUNTIME_EDGES`, mocks through `Relations.shadows`), the
test-selection recording that
[spec 0027](0027-a-test-is-selected-by-what-it-executed.md) reads, and
[ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(a request is the edge, a binding is the name, and a mock is neither).

## Purpose

`covering` says which tests ran a line, and selection says which tests an edit
reached. Neither says **where the region behind a file begins**. In this
repository `tribunal/src/ui/review.tsx` has about 130 lines of its own and over
10,000 behind it that no test reaches any other way; `cli/src/dispatch.ts` has
about 500 and 5,000.

That fact answers two questions people already ask. A test author asks where a
test can reach the most code: every test that reaches the region enters through
the choke point, and the reality reading says how much of the region those
tests executed. A selector asks how far an edit can travel: an edit anywhere in
the region can select no test that does not enter through its choke point, so
the choke point's entrants are the upper bound of that edit's selection, and
the answer can state it.

## Definition

**Theory.** X is a choke point for Y when every runtime import path from a test
to Y passes through X. Tests are the entries. Choke points nest: the immediate
choke point of each file gives a tree, and X's region is its subtree. Cycles do
not break the definition, because dominance is defined on any graph with a
root.

- Only runtime edges count. A type-only import never runs and never carries a
  test to Y.
- A barrel is seen through by name. A test that imports `{ plan }` from a
  package entry reaches the file declaring `plan`, not every file the entry
  re-exports. Otherwise every package entry is a choke point and the answer
  says nothing.
- A mock cuts the path. A test that mocks X does not reach Y through X.
- When any test imports Y directly, no file above Y is its choke point, and Y
  heads its own region. A file most tests import directly is reported that way,
  which is a true answer about it.

**Reality.** X is a choke point for Y when X has an import path to Y and every
recorded case that executed Y also executed X. The import path condition keeps
out what every case runs anyway: a setup file, a logger, a shared helper that
does not lead to Y. The recording holds places visited, not their order or
the import that led from one to the next, so this is set inclusion: evidence
that X ran whenever Y ran, never that a case reached Y through X. Every file
that qualifies is reported, ordered by its distance to Y on the graph; none is
promoted to the one a case went through.

Executed means a function in the file ran. Evaluating a module's top level is
loading, which the recording keeps apart, and a file that was only loaded is
not in the reading.

## The two readings together

| Theory | Reality | Reading |
|---|---|---|
| choke point | choke point | **Confirmed**, on the number of cases stated. |
| choke point | not | Cases executed Y without X, by a path the graph cannot see: a dynamic import or `require` whose specifier is not a quoted string, or a file the harness loads. A dynamic import of a quoted string is an edge the reading walks, as [spec 0097](0097-a-consumer-pays-for-what-it-loads.md) reads it. **The graph has a hole**, and the answer names those cases. |
| not | choke point | The graph has a path to Y that avoids X, and no recorded case ran Y without also running X. Whether a case took that path cannot be read from places visited. **No case shows the path is needed**, and the answer names the path and the files on it that no case ran. A path with such a file is untested; one whose every file ran is unknown, never called untested. |
| not | not | No region. |

A region is reported by its size: files, lines, and the number of tests that
enter it through X.

Absent is not empty:

- With no recording, the reality reading is **unmeasured**. It is never "not a
  choke point", and the theory reading stands alone with that said.
- A file no recorded case executed has no reality reading.
- A pair supported by few cases reports its case count. It is never called
  confirmed on a count it does not state.

## Where it is read

Not as a new question. A choke point is a line in answers that already exist:

- `covering` for a file names its choke point and the region behind it, so the
  reader knows whether the tests they see enter here or further up.
- `journey-map` marks the files where a region begins.
- Selection for an edit inside a region states the choke point and the number
  of tests entering through it, as the bound on what that edit could select.

## What would discharge it

1. A dominator pass over `Relations` with tests as entries, runtime edges,
   barrels resolved by name and mocks cut. Fixtures for a diamond, a cycle, a
   barrel that re-exports two unrelated files, a mocked choke point, and a test
   importing Y directly. `dominatorsOf` in `core/relate` computes the
   dominators of one root; several test entries hang from a virtual root.
2. The reality pass: set inclusion over executed files, restricted to files
   with an import path to Y. One fixture where a setup file every case runs is
   not a choke point, one where a dynamic import whose specifier is not a quoted
   string makes the readings disagree
   and the answer names the cases that went around, and one where a case runs
   both X and the side path's files, so X qualifies and the side path reads
   unknown rather than untested.
3. The four-way reading and the absent cases above, each with a test that
   fails on an answer that reads absence as a negative.
4. The line in `covering`, `journey-map` and selection, each measured on this
   repository and on the seven-MUI corpus, with the time it adds to each answer
   stated.
