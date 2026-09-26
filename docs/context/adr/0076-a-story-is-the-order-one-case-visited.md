# ADR-0076 — A story is the order one case visited, taped beside the record

**Status:** accepted
**Date:** 2026-09-26 (arms, counts and the picked level added the same day)
**Narrows:** ADR-0056 (a journey is the places visited)
**Relates to:** ADR-0002 (absent is not empty), ADR-0069 (every answer has an
owner), [spec 0071](../../specs/0071-a-test-is-read-alone.md)

## Context

A journey is a set: which regions one execution ran, and nothing about order.
ADR-0056 forecloses order, counts, spans and stacks in the record, because
`async` makes all of them false in a page, and because selection and comparison
never read them.

The reader that wants order is somebody focused on one test — a person or an
agent about to change code the test goes through. Wallaby calls what they want
a test story. It is not a selection input and not a comparison input; it is a
map to read before opening files.

The emitted probe already sends every hit through the root behind
`globalThis.__VA__`. A root that hands out a zero pass mask and a zero-length
log makes every hit call `g(entry)` with the realm-wide region index and the
evaluating bit. So order can be taped by swapping the root, with no change to
the transformer and no change to the record.

## Decision

**A story is the time order of region visits in one realm, for one case,
taped only under `VARIANCE_AUTHORITY_STORY=1`, written beside the recording and
never read by anything that selects or compares.**

1. **The tap wraps the engine.** `story-tap.cts` is a root that forwards every
   hit to the engine after taping it. The presence record under the tap is byte
   for byte the record without it; `collectors.test.ts` gates on that.
2. **One file per case**, `<digest>.story` in `coverage.stories/` beside the
   record the run writes, the last run replacing the earlier one. Beside the
   record, not at the top of the cache layer, because a story is named through
   that record's regions: with suites declared, a story the unit suite taped is
   read through the unit suite's record. It keeps what ran outside any case just before the
   case as `before`, and says what it could not keep: `untaped` after the tape
   limit, `interleaved` when another case's work ran inside this one under
   `continuations`, `stopped` when the body threw.
3. **The reader draws a route, not a trace.** `variance story` names each visit
   by its declaration — the function, handler or top level the region belongs
   to — merges consecutive visits to one declaration, draws modules evaluated
   one inside another as one `loaded` stop, and folds tandem repeats so a loop
   is drawn once. Each stop carries how many times its declaration was entered
   and the arms it went into, each with a count; a loop carries how many times it
   went round, and its passes fold even when they took different arms, their
   counts added. The map is not the territory: the route answers *which parts of
   the system does this case go through, in what order, and down which arms*, and
   a debugger answers the rest.
4. **The route is read a part at a time, at a level picked from its size.** A
   long case is hundreds of stops, and the reader — an agent's context most of
   all — needs a page, not a tape. So stops are numbered as steps, and one part
   of a route is drawn at up to five levels: packages, files, declarations,
   steps with other workspace packages passed through, every step. The reading
   is the finest level that fits in sixty lines, it names the level and the size
   of the next one down, and `--in`, `--around` and `--whole` narrow the part,
   which picks again inside it. A package is the nearest `package.json` above a
   file; steps in a row inside a package that is neither the test's own nor one
   `--in` named are one line naming the package, the steps and the declarations.
   A trace-style parent id per stop was considered and rejected: the tape holds
   visits, not calls and returns, and a function that returns without entering
   another region leaves no mark, so a parent drawn from it would nest each
   sibling under the one before. The step number joins the parts and claims
   only order.

   Three alternatives were weighed for the level. A fixed overview, the first
   version of this reader, spent a second call on every short case to reach the
   steps it already fit. Depth limits and hiding constructors, as in per-test
   sequence diagrams (Cornelissen et al., CSMR 2007), cut by a structure the
   tape does not have. A utility metric by fan-in and fan-out (Hamou-Lhadj and
   Lethbridge, ICPC 2006) finds the library code a reader skips by computing it;
   the manifest already says which package a file is in, so the boundary is
   carried, not computed (ADR-0069), and nothing is hidden that the line does not
   name.
5. **Narrowing is the runner's.** The variable tapes every case the run runs;
   `-t`, a file argument or a filter picks the case.

## What this narrows in ADR-0056

ADR-0056 forecloses order *in the record*. This keeps that: nothing here is a
field of the record, a column of the snapshot or an input to selection. What it
admits is a second artifact, written only on request, whose claim is *this case
visited these places in this order in this realm*. It claims no nesting and no
stack: a route drawn from it shows a return to a caller as another stop, and
async work of the same case shows where it ran.

## Consequences

- A story is named through the coverage snapshot, which does not know the text
  the story was taped from. The reader matches a module row by region count and
  draws a module it cannot match as its file, listed as unresolved. Carrying the
  source digest on the story's rows is a `// TODO:` in `story/read.ts`.
- A page case (browser Vitest) and a service head write no story; both are
  `it.todo` markers.
- The accessor cost ADR-0056's runtime rejects is paid only under the variable.
