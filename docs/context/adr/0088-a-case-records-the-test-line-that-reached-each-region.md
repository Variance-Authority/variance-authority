# ADR-0088 — a case records the test line that reached each region

**Status:** accepted
**Date:** 2026-10-10
**Narrows:** [ADR-0056](0056-a-journey-is-the-places-visited.md) decision 1
(record places)
**Relates to:** [ADR-0076](0076-a-story-is-the-order-one-case-visited.md) (a
story is the order one case visited),
[spec 0100](../../specs/0100-a-case-ends-where-it-decides.md) (a case ends
where it decides),
[`packages/sense/src/instrument/probe-cuts.cts`](../../../packages/sense/src/instrument/probe-cuts.cts),
[`packages/sense/src/test-selection/case-lines.ts`](../../../packages/sense/src/test-selection/case-lines.ts)

## Context

ADR-0056 records one presence bit per region and subject, and nothing else:
no order, no span, no count. The reason is the page. Between a function's
entry and its resumption other executions run, so an order of the page's
crossings is somebody else's work interleaved with yours.

A test case's set names what it reached, and the rarest of those regions is
where its decision lies. It does not say which line of the test reached that
region, and without the line a reader cannot tell what each statement of a
test added — its cadence. That is a fact about every case, read by readers
that walk every case, so a story per case
([ADR-0076](0076-a-story-is-the-order-one-case-visited.md)), which pays for
every visit, is the wrong price for it.

A test-runner seam is not a page. It runs one case at a time, keeps a bucket
per case and one ambient bucket per file for hooks, and its log is written in
first-reach order before the close sorts it.

## Decision

**Under a test-runner seam, a case records, for each region it crossed, the
line of the test statement that first reached it, and whether that statement
was the case's own or a hook's.** Nothing else in ADR-0056 decision 1 moves.

1. **A cut is a log length.** The seam's transform inserts a call before each
   statement of a test or hook body, into nested blocks and not into nested
   functions: the callback a `waitFor` is handed is part of the statement that
   hands it. The call records the current bucket's log length beside the
   statement's line. No snapshot is taken and nothing is read.
2. **The close charges each region to the last cut before its first entry.**
   A region reached in a case's own bucket is charged to the case's line; one
   reached in the file's ambient bucket, by a `beforeEach` or another hook, to
   the hook's line, flagged ambient. A case's own line wins over an ambient
   one for the same region. A region reached before any cut stands at line 0.
   The transform cuts a whole test file or none of it, so a case of a cut
   file whose own bucket reached nothing has lines too. A case whose body ran
   uncut has none: a helper outside the file declared it, or the transform did
   not know its registrar.
3. **The record stores one value per region per case, as runs.** A case's
   values are kept over each module's regions as runs, and the value most of
   its modules hold alone is stored once: a hook that reaches a thousand
   modules costs one value. A case whose lines were not recorded stores no
   bytes, and a record written without cuts holds no column at all, which a
   reader reads as *lines not recorded*.
4. **It is on by default and can be turned off.** `cadence: false` on the
   Vitest, Jest or Rstest options leaves test files as they are; a Jest
   journey run never cuts.
5. **Selection reads none of it.** Which cases run is decided by the set, as
   before.

Not admitted: a rank within a statement, counts, repeats, spans, stacks,
depth, and anything written on a page. ADR-0076 let a story claim only order
because order was all its tape could vouch for; a cut vouches for less, the
statement a region was first reached under, and claims only that.

## Consequences

- The record grows by the lines and a test run by the calls. On this
  repository's unit suite the lines add 2.2% to the record and on MUI's
  `mui-material` 2.4%; the suite's duration stays inside its run-to-run spread
  on both. Spec 0100 holds each under twice what it adds to.
- The cut moves the columns after it on a statement's line, and a runner
  writes an inline snapshot into the call a stack frame names by line and
  column. The transform returns a source map back to the file as written:
  Vitest and Rstest take it, and the Jest seam moves the wrapped transformer's
  map back, returned or inline.
- A case whose async work interleaves differently between runs can reach a
  region from another line; the line recorded is the one this run reached it
  from.
- A layer carries each case's lines from whichever side recorded its set, and
  a case one side recorded without lines has none.
- Test files now pass through the seam's transform. The cut goes in after the
  probes, so a test file a seam probed before, one Vitest's or Rstest's
  `include` takes, keeps its regions; one it did not, every Jest test file
  among them, carries the cut alone.
