# Spec 0044 — a contribution is never lost quietly

**Missing:** the exclusion, the ordering and the accounting that make one record
out of many writers. Three fan-ins exist — worker to run, shard to index, run to
index — and they share no vocabulary: one of them takes a lock, the other two do
not; nothing numbers a snapshot, so no two can be ordered; and every merge
computes how much it dropped and then discards the number.
**Built on:** [0029](0029-what-a-run-remembers.md) (the union-within-a-generation
rule this is the missing half of),
[0043](0043-a-record-costs-what-the-run-cost.md) (the fold whose memory this
must also bound),
[ADR-0059](../context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md)
(what invalidates a record).

## Purpose

[0029](0029-what-a-run-remembers.md) settled what a row means when two runs
disagree about it. It did not settle what happens when two runs *write at the
same time*, and the code has since answered that question three different ways
without anyone choosing between them:

- `recordExecution` takes `<coverage>.lock` before its read-modify-write
  (`packages/sense/src/test-selection/journal.ts:364`).
- The shared runner fold reads the index, layers onto it and renames under one
  lock it does not wait for — it notes a busy index and drops the merge
  (`packages/sense/src/test-selection/selection-fold.ts:110-119`). The Jest
  reporter does the same (`jest-reporter.ts:140-149`).
- `nameModules` — read-modify-write over the file that assigns every module its
  id — reads at `packages/sense/src/module-names.ts:127` and publishes at `:140`
  with no lock between them, and swallows its write errors at `:141`.

Two Vitest projects, a Jest multi-project run, or a Vitest run beside a
Playwright run each read the index, layer onto it, and rename. **The later rename
discards the earlier run's whole contribution**, which is exactly the failure the
lock exists to prevent, and nothing anywhere says it happened.

The `nameModules` case is worse than a lost contribution and is the reason this
spec is not only about tidiness. Two unlocked callers read the same count and
hand the same id to two different paths. The id is baked into emitted code and
joined against by every record store, so one module's crossings are attributed to
another — silently, and **in the narrowing direction**.

## What would discharge it

**1. One exclusion, named after what it protects.** The lock is taken by every
writer of the index and of the names table, or by none. Today its name is derived
from the coverage file path while it also protects `names.bin`, whose path is
derived from the cache layers and the root; the two coincide only when the caller
did not name its own `coverageFile`. A lock that does not cover the second
artifact is not an exclusion, it is a habit.

**2. A held lock proves liveness, and a broken one is broken once.**
`index-lock.ts` writes a pid and never touches the file again, calls a lock stale
at sixty seconds, and releases by deleting whatever is at the path. All three are
wrong in the same direction:

- A merge of a 200,000-module index that legitimately runs past sixty seconds has
  its lock broken by a waiter, the waiter creates its own, and the original
  holder's `finally` deletes **the waiter's** lock. Two writers then proceed with
  no lock at all.
- `rm` then `continue`, with no re-check, lets N waiters all observe one stale
  lock and all break it.

A holder refreshes while it works, a releaser checks that the lock is still its
own, and a stale lock is broken under a compare-and-swap rather than a delete.
The pid is already written and never read; reading it is the liveness check.

**3. A snapshot is numbered.** There is no generation, sequence or completeness
marker on the file. `TestCoverage` carries `version`, `instrumentation`, an
optional `commit`, tests and modules, and nothing that orders two of them. The
only completeness signal in the system is the per-test `complete` boolean, which
is a property of one observation and not of the index.

Without a number, nothing can tell a partially-landed fold from a complete one,
nothing can detect that a merge was lost, and the question *is this index
complete?* has no field to read. Nor is there a mechanism elsewhere to borrow:
`immutable-log.ts:25-29` carries a `format`, a `version` pinned to 1 and a list
of segments — a format version, not a generation — and publishes by the same
read-modify-write-and-rename with no expected-prior check
(`immutable-log.ts:122-140`). `names.bin` has the lost-update hazard this spec
indicts `coverage.bin` for, one layer down, and its compaction discards segments
a concurrently-published manifest may still name.

**4. A demotion carries its reason.** Three sites write `{ ...test, complete:
false }` and drop why: `test-selection/merge.ts:166`, `test-selection/merge.ts:357`, `format-layer.ts:266`. The
reason is computed — `stitchJourneys` builds a `because` string — and reaches
stderr once, then is gone.

An operator whose suite has stopped narrowing cannot learn from the record
whether a head was silent, a module was mislaid, or a shard could not be
instrumented. The demotion is the correct behaviour; losing the reason is the
defect. It belongs on the test row, beside the flag it explains.

**5. A merge says what it dropped.** Every merge already counts the tests it
demoted and the crossings it could not place, and every one of them throws the
count away. A merge returns what it accepted, what it carried, what it retired
and what it demoted, and a run prints it. A suite that stops narrowing is then a
number that moved rather than a mystery.

**6. The fold is bounded like everything else.** `land` decodes every shard
concurrently through `Promise.all`, then builds two `Set<string>` per block over
the union of all shards, then materializes the output model: N decoded snapshots
plus the whole crossing relation as JavaScript strings, with no budget parameter
and no slicing. `foldCrossings` takes a budget; the shard fold does not. **The
fan-in this whole feature exists for is the one place in the system with no
ceiling**, and it is the same object model [0043](0043-a-record-costs-what-the-run-cost.md)
indicts, N times over.

**7. The two implementations of the merge agree or become one.**
`layerTestCoverage` is documented as byte-identical to
`encodeTestCoverage(mergeCoverage(decodeTestCoverage(bytes), current, onDisk))`
and reimplements its rules over columns. `retired` and the multi-row claim are
each written twice, and the `sameNumbering` gate present in the object path has
no counterpart in the columnar one — so a re-recorded module whose regions were
reseated is carried by one and mislaid by the other. The equivalence is asserted
by fixtures. It needs to be a property the two are checked against, over
generated inputs, or the second implementation needs to go.

**8. Three disagreements that are decisions nobody has made.**

- `foldTestCoverage` keys modules by path alone and throws on a second row with
  a different digest; `mergeCoverage` deliberately indexes a path to all of its
  rows and matches by digest. A shard that saw two builds of one module — a
  second environment, a second transform — **cannot be landed at all**, and the
  refusal names two shards that are both correct.
- `land` calls `mergeCoverage(previous, folded)` with no `onDisk`
  (`packages/cli/src/commands/land.ts:75`), so carried modules are never re-cut
  when shards are landed. The recorder paths do pass it. Landing a CI fold over a
  local index therefore moves the index to the fold's commit while carried
  modules keep rows cut from text that has since moved, and nothing is demoted
  for it. That is a false skip, and `land.ts`'s own docblock describes the layer
  as if it behaved like the recorder's.
- `mergeCoverage` drops the entire previous index when the instrumentation
  recipe differs (`test-selection/merge.ts:240`), with no message anywhere. The fold refuses
  loudly for the same disagreement between shards; the layer discards quietly. A
  bump of the instrument throws away months of evidence on the next run's
  teardown. Discarding is right — [0029](0029-what-a-run-remembers.md) requires
  it — and doing it without a word is not.

**Acceptance:** two runs against one repository, started together and finishing
in either order, where both contributions survive and the writer that waited says
it waited — *both contributions in the index* while a run still writes the index,
and *both contributions in the overlay, and in the index after the fold that
follows* once [0043](0043-a-record-costs-what-the-run-cost.md) item 3 lands. The
two are the same requirement against two write paths, and this spec's item 1
follows the index writer wherever that item puts it. Then the same pair with `nameModules` racing, where
no two paths hold one id. Then a fold of sixteen shards of the 200,000-module
fixture under `/usr/bin/time -l`, reporting a peak under the 600 MB ceiling. Then
a landed fold over a local index whose carried modules have moved on disk, where
every test whose ranges are no longer readable is demoted.

## What it forecloses

**No writer is exempt because it is fast.** A read-modify-write under no lock is
a lost contribution whatever its size, and the reporters' path is the one most
runs take.

**Losing evidence is permitted; losing it silently is not.** Every rule here
that drops a row — a changed instrumentation recipe, an unreadable carry, a
mislaid module — keeps its licence to drop. What it loses is the option of doing
so without a number.

**A number on the file is not a lock.** A generation orders snapshots and detects
a lost merge after the fact. It does not serialize writers, and it may not be
offered as a reason to skip item 1.

**The three fan-ins stay three.** Journey to subject, worker to run, and shard to
index answer different questions over different inputs, and nothing here proposes
one mechanism for all of them. What they share is this contract, not their code.
