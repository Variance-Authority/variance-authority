# Spec 0043 — a record costs what the run cost, not what the repository holds

**Missing:** a producer and a publish whose cost is set by the run rather than
by the snapshot they land in. Both ends of the write path materialize the whole
repository's relation as objects: the reporters build one `string[]` per region
before encoding, and laying one re-run test file over a 200,000-module snapshot
decodes and re-encodes all of it — 3.1 s and 1,111 MB against a 600 MB ceiling
([journal 0051](../context/journal/0051-the-snapshot-fits-and-the-publish-does-not.md)).
**Built on:** [0029](0029-what-a-run-remembers.md) (the rows this writes and the
completeness rule that decides when one may be replaced),
[ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md)
(one pool per snapshot, both relations out of it),
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) (a rewrite is
justified by a measurement, and the measurement here indicts the data model).

## Purpose

The read side of this feature is settled and measured: opening a
77.2 MB snapshot reads 43 KB of it, and answering for a hundred changed files
reads 3.69 MB and costs 60 ms
([journal 0051](../context/journal/0051-the-snapshot-fits-and-the-publish-does-not.md)).
Nothing on the write side is settled, and the asymmetry is not an accident of
effort. **A reader was built against an address; a writer was built against a
model.**

That distinction is the whole spec. A snapshot is a set of columns at offsets, so
a question can be answered by decoding the runs it lands in. The same file is
produced by handing `encodeTestCoverage` a `TestCoverage` object — every module,
every region, every region's audience as an array of test paths — so producing it
costs the repository whatever the run cost. At the shape this is built for that
is not a slow path. It is an impossible one:

- **Recording.** `crossingsOf` at
  `packages/sense/src/test-selection/instrumented-modules.ts:434` returns
  `Map<ModuleId, Map<ordinal, Set<string>>>` — one entry per region a test
  entered, holding test paths as strings. Thirty-one test files of a
  40,000-module shape cost 2.5 GB; five hundred exhaust a twelve-gigabyte heap.
  The shipped reporters call it: `selection-fold.ts:83` and `jest-reporter.ts:97`.
- **Publishing.** `layeredCoverage` no longer decodes the snapshot to that
  model — `format-layer.ts:238-260` copies an untouched module's rows column to
  column as integers, and `:335-350` remaps each carried crossing set once per
  distinct set rather than once per region. What it still does is open and
  rewrite *every* column and re-intern the *whole* pool to replace ten modules
  of 200,000, which costs 3.1 s and 1,111 MB. The defect is that the cost is
  proportional to the file rather than to the change, not that a model is built.

Both are the same defect at two ends, and it is a defect rather than a limit:
the fold that does not have it is already in the repository, unwired.
`foldRun` at `packages/sense/src/test-selection/run-fold.ts:84` reads the same
fixture's 103 million module rows and 826 million crossings inside 450 MB by
keeping frames on disk and handing back a set id per region against a pool. It
has no caller, and its own docblock says the shipped path *used to be*
`readJournals` then `crossingsOf`, in the past tense, about a thing both
reporters still do.

## What would discharge it

**1. A region's audience is an id, not a list.** `CoverageBlock.testFiles` at
`packages/sense/src/test-selection/index.ts:96` is `readonly string[]` and
becomes a `SetId` into a `CrossingSets` pool carried beside the modules. This is
the one change, and it is not local: `journal.ts`, `vitest.ts`,
`jest-reporter.ts`, `merge.ts` and `format-layer.ts` all construct that field, so
they move together or not at all. `coverageModule()` at
`instrumented-modules.ts:338` is where the array is built today and where the
interning belongs.

The pool is not new work — `crossing-sets.ts` is built, tested, and already what
the format writes and reads. What is unbuilt is the pool reaching the encoder
*unflattened*. Today the interned relation is decoded back into arrays on the way
in and re-interned on the way out, so the win ADR-0061 measured is paid for and
then thrown away.

**2. The reporters fold rather than collect.** `foldRun` becomes the path both
reporters take, and `foldCrossings` takes one `CrossingSets` instead of
interning two. A reporter's peak is then set by the slice budget it was given
and by the pool, neither of which is the repository's crossing count.

**Why a slice budget rather than a smaller object:** the frames are on disk
already. Reading them twice costs the disk and bounds the memory; holding them
once costs memory proportional to a product of two axes — modules and tests —
that a repository grows independently. The second is the shape that has no
setting at which it fits.

**3. A run publishes an overlay, and a fold publishes a snapshot.** A run appends
what it saw to an overlay beside the snapshot and stops. Queries read the
snapshot through the overlay. The fold into the snapshot happens on a cadence
somebody chooses — a commit hook, a CI step, a command — and never on a save.

The overlay is append-only and framed the way a journal is, so a torn tail is
detected rather than inherited, and a reader that finds one drops the overlay
rather than the snapshot. An overlay that cannot be read costs the run it would
have recorded, which is the direction [0029](0029-what-a-run-remembers.md)
already requires of every cache in this system.

**Overlay reads may not narrow.** The rule is one sentence in two halves, and
both halves are needed. *Across* test files the reader unions: a test file the
overlay does not mention keeps the snapshot's answer, and a test file neither
holds is unknown and runs. *Within* one test file the overlay supersedes — a
later recording of a test file is the truth about that file, which is what
layering already does at `format-layer.ts:262-266`. Nothing is subtracted in
either direction, so an overlay lost between the run and the query costs a full
run and can never cost a skipped test.

**The overlay interns into a pool of its own.**
[ADR-0061](../context/adr/0061-a-crossing-relation-is-interned-not-owned.md) holds that a
`SetId` is meaningful only against the pool that minted it, so the overlay may
neither borrow the snapshot's ids nor renumber them. A query opens two
`CrossingSetsView`s and joins them on test *names*, which is the only coordinate
the two files share. An overlay that cannot do that is an overlay that has to
renumber on every append, and renumbering is the cost this item exists to avoid.

**4. The encoder copies the bytes it is not changing.** A publish that replaces
ten modules of 200,000 knows which ten. Every other module's region rows,
crossings and dictionary entries are bytes at an offset in a file that is already
open. The encoder takes the logical model today, so it materializes one; taking
the previous file plus a delta is what makes the cost proportional to the delta.

This is the item to do last and the one to skip if the overlay is enough. A
cadence somebody chooses can afford three seconds. A per-save path cannot, and
item 3 removes the per-save path.

**5. The ceiling is a gate, not a note.** 600 MB peak RSS, measured with
`/usr/bin/time -l`, for recording a suite and for publishing a run, at the target
shape. A script that reports the peak and exits non-zero above it belongs beside
the others in `packages/sense/scripts/`, and the number it checks is a count of
bytes rather than a ratio of two timed runs, so it means the same thing on any
machine.

**Acceptance:** `snapshot-scale.mjs layer` against the 200,000-module fixture,
run twice over the same snapshot — once replacing 10 modules and once replacing
100 — with both peaks under 600 MB and the two wall clocks within 2x of each
other. Proportionality is not a predicate one run can answer; two points and a
bound is. Then a suite of 2,000 test files of a 40,000-module shape recorded end
to end under the same ceiling, where today it breaks it at about thirty-two test
files — which needs a fixture of that shape, so this half is blocked on
[0047](0047-a-skip-list-is-worth-what-it-skips.md) item 3 and says so rather than
waiting quietly. Both under `/usr/bin/time -l`, both with the command in the
journal.

**6. Something retires what the repository no longer holds.** Every item above
bounds the cost of a *run*. Nothing bounds the cost of the *file*. A module
deleted from the repository is carried verbatim with all of its crossings —
`test-selection/merge.ts:415` carries it because nothing at the path says the rows are about a
file that is gone, and `format-layer.ts:248` pushes every unclaimed row onward —
and a test file that no longer exists keeps its row and its `complete` flag
(`format-layer.ts:263-265`). So the snapshot is monotonically non-shrinking over
a repository's life, and the 600 MB ceiling is approached from this side too,
by a repository that never grew.

**Acceptance:** a fold retires rows for paths absent at its own commit, says how
many it retired, and a test deletes a thousand modules from a fixture and asserts
the snapshot got smaller. A run may not do this — a run sees a subset of the
tree and would retire what it merely did not look at — so this belongs to the
cadence [0044](0044-many-writers-one-record.md) owns.

## What it forecloses

**A run may not hold the repository's relation.** Any structure sized by
`modules x tests` is refused on the write side as it already is on the read side,
whatever it is made of. That forecloses the obvious fix — a smaller object per
crossing — because the object is not the term that grows.

**A publish is not a save.** Once the overlay exists, nothing may make writing
the snapshot a precondition of a run completing. A run that records and does not
publish is the ordinary case, and a tool that cannot say what it has not folded
yet is an incomplete tool rather than a fast one.

**The overlay is not a second format.** It holds rows in the columns the snapshot
holds them in, through the same codec and the same validation, and differs only
in carrying its own pool and its own section index. Anything more than that is a
second decoder with its own version and its own way of being wrong, and a
separate shape is how a cache stops costing a run and starts costing an answer.
