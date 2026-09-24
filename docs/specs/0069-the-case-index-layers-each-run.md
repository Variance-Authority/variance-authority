# Spec 0069 — the case index layers each run

**Missing:** a case index that holds the whole suite. The snapshot does:
`layeredCoverage` in `packages/sense/src/test-selection/selection-fold.ts` lays
each run over what the snapshot held, retiring the rows of every test file that
ran to completion and keeping the rest. The case index beside it does not.
`writeCaseIndex` writes this run's journals and never reads the file it
replaces, so `cases.bin` is always the last run and nothing else. The FIXME at
that call marks the defect.
**Built on:** the snapshot's layering (`packages/sense/src/test-selection/merge.ts`,
`merge-carry.ts`), the case fold (`case-fold.ts`), and
[0067](0067-a-case-carries-its-outcome.md) (a case that stopped).

## Purpose

`covering` and both editors read the case index, and the case index decides
what a region's state is. After `vitest run src/cart.test.ts`, every region that
file did not reach is painted **unwalked**, "every case that could have reached
it finished", though the rest of the suite reaches it and simply did not run. A
false *unwalked* is worse than no mark: it is the one state that says a test is
missing.

The same run that corrupts the editor is the one a developer makes most often:
one file, while writing it. `test:since` makes it too, and 0068 will make it on
every save. So the record has to survive partial runs before anything is built
on them.

## What would discharge it

**1. A run replaces what it re-ran and keeps the rest.** The case fold reads the
index it is about to replace, and a case whose test file this run finished is
retired, with every crossing it held, exactly as the snapshot retires the file's
rows. A test file that did not finish is laid over the old one rather than
replacing it, as the snapshot does. Every other case is carried. A deleted test
file retires its cases at the next whole run and not before, because a partial
run cannot tell *deleted* from *not selected*.

**2. Regions are carried across commits the way the snapshot carries them.** A
carried case's crossings name blocks in the text it ran over. They are matched
to the current blocks by address (the region's name, its path, and which
occurrence it is) and kind, the rule `addressed` and `reusableBlock` in
`merge-carry.ts` already apply. A block that cannot be matched drops its
carried crossings rather than guessing a place for them, and the region reads as
the cases that did reach it now say.

**3. The index names the run that wrote it last.** One list: the cases the last
run held, with the commit and time of that run. It answers 0071 (a test read
alone) and 0070's local half (what an edit to a test moved) without keeping a
second copy of anything. The cases a run retired are kept for one generation as
the previous layer, and the fold after that drops them.

**4. The same budget.** The fold stays bounded the way `foldCaseRun` is today:
one module slice of the test-by-region relation at a time. Reading the old
index adds its size once, and not a second relation.

## Acceptance

1. Record the whole suite, then run one test file. `covering --file` on a module
   that file does not import answers exactly as it did after the whole run.
2. Edit a test so that it stops entering a function, then run that file alone.
   The function's cases no longer include it, and every other case is still
   there.
3. A run of one file in which a case stops leaves the cases of every other file
   as they were. The regions past the stop read as holes only where that case
   could have reached them.
