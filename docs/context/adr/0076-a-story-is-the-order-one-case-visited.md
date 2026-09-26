# ADR-0076 — A story is the order one case visited, taped beside the record

**Status:** accepted
**Date:** 2026-09-26
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
2. **One file per case**, `<cache>/…/story/<digest>.story`, the last run
   replacing the earlier one. It keeps what ran outside any case just before the
   case as `before`, and says what it could not keep: `untaped` after the tape
   limit, `interleaved` when another case's work ran inside this one under
   `continuations`, `stopped` when the body threw.
3. **The reader draws a route, not a trace.** `variance story` names each visit
   by its declaration — the function, handler or top level the region belongs
   to — merges consecutive visits to one declaration, draws modules evaluated
   one inside another as one `loaded` stop, and folds tandem repeats so a loop
   is drawn once. Branch arms and loop counts stay on the tape. The map is not
   the territory: the route answers *which parts of the system does this case go
   through, in what order*, and a debugger answers the rest.
4. **Narrowing is the runner's.** The variable tapes every case the run runs;
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
