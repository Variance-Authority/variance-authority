# Spec 0048 — one worker's bad journal costs the whole run, and the two runners disagree about what to do with it

**Missing:** a production path that survives its own failures. A crossing is
observed in a worker's memory and reaches disk once, in an `afterAll`, written
straight to its final name. The journal format is framed and refuses a truncated
file — and that refusal is taken inside one `Promise.all` over every file in the
run directory, so one damaged journal, or one `.DS_Store`, throws for the whole
run and names nothing. Underneath that, the two reporters answer an unknown
module id three different ways, one of them in the narrowing direction.
**Built on:** [0043](0043-a-record-costs-what-the-run-cost.md) (the per-worker
model this bounds), [0044](0044-many-writers-one-record.md) (which begins where
the journals are already on disk),
[ADR-0059](../context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md).

## Purpose

Specs 0043 through 0047 all start from journals that exist. Nothing states what
has to be true for them to exist.

What is already right, and is the floor this spec builds on: the journal opens
with `VAJRN` and a version (`journal-format.cts:33`), every read is bounded, and
`decodeJournal` refuses a file that runs out or has bytes left over
(`journal-format.cts:116`). A truncated journal is *refused*, not decoded short.
Completeness is gated too — a test file whose journal never arrived is
`complete: false` (`finished-files.ts:227`), and `test-selection/select.ts:130` builds `whole`
only from tests the snapshot recorded whole, so an unrecorded file cannot be
skipped. Neither of those is the problem.

The problem is everything around them.

- The refusal is taken in bulk. `readJournals` (`finished-files.ts:230-241`)
  `readdir`s the run directory with **no extension filter** and decodes every
  name inside one `Promise.all`. One truncated journal, or one file the
  operating system put there, throws for the whole run — and the error names no
  file, so the message is the same whichever caused it.
- The write is not durable. `worker-source.ts:82-91` mints `<pid>-<uuid>.va`,
  encodes the journal in memory and `writeFile`s it to its final path: no
  temporary name, no rename, no fsync. A worker killed mid-write leaves a file
  that will be refused — which is correct — but one that will take the run down
  with it, per the previous point.
- **An unknown module id is handled three ways.** Vitest *throws*
  (`finished-files.ts:213`), which aborts the settle and loses the run. Jest's
  crossing path *silently drops the row*
  (`jest-reporter.ts:95` filters `journal.modules`), so the crossing disappears
  while the test stays complete — a narrowing. Jest's finished-file path sets
  `placed = false` (`jest-reporter.ts:186`), which demotes correctly. One
  condition, three behaviours, and the middle one is the unsafe one.
- `run.settled` is set at `selection-fold.ts:133-134` and never reset, so `vitest
  --watch` records the **first** run and silently ignores every one after it.
  Jest does not have this bug: `jest-reporter.ts:71-77` re-mints the run
  directory in `onRunStart`.
- The run is marked settled before any work is done, and the run and case
  directories come off as trailing statements — `selection-fold.ts:128-129` for
  every runner that folds through it, `jest-reporter.ts:165-167` for Jest. The
  shared fold's `try`/`finally` covers the shims and nothing else, so a throw in
  between loses the run *and* leaves its directories behind. A killed process leaves them too, and nothing ever
  collects them.
- Counts are `Uint32Array` increments with bit 31 taken for `EVALUATING`
  (`instrument/index.ts:238`), and the increment does not saturate. A region
  entered 2³¹ times does not overflow into a wrong count, it overflows into the
  flag that means *this belongs to every subject*.
- `instrument()` returns `undefined` when the parse produced errors
  (`instrument/index.ts:161`) and the caller uses the original text. That is the
  right refusal, and it is silent: nothing counts it. The one check that exists,
  `noteAnEmptyRecord` (`finished-files.ts:74-84`), fires only when
  `instrumented === 0 && testFiles > 0`, and Jest never calls it.
- `test-selection/journey.ts:233-234` deletes a journey's counters and factory at the top of
  `report()`, then returns without sending at `:253` when the channel is
  undefined. The observation is destroyed before the code discovers it cannot be
  delivered.
- `instrumented-modules.ts:165-167` ignores what `writeSync` returns on every
  inventory append, so a short write is a silently truncated frame.

None of these is marked. `FIXME`, `it.todo` and `test.todo` appear **zero**
times across `packages/sense/src/test-selection` and
`packages/sense/src/instrument`.

## What would discharge it

**1. One bad journal costs one journal.** Filter `readdir` to the extension the
writer uses, decode each file in isolation, and report what failed by name and
by reason. **Acceptance:** a run directory holding one truncated `.va` and one
`.DS_Store` still settles, the summary names the truncated file, and the test
file it belonged to is demoted rather than the run lost.

**2. A journal is written durably.** Temporary name, fsync, rename — the rule
`test-selection/index.ts:312` already states for the snapshot, applied one layer earlier.
**Acceptance:** with a failure injected between write and rename, the run
directory holds no `.va` at all — not a file a reader has to refuse.

**3. An unknown module id has one answer, and it is not a silent drop.** Pick
the behaviour, write down why, and make both runners take it.
**Acceptance:** the Jest filter at `jest-reporter.ts:95` is gone, a journal
naming an id the inventory does not hold demotes its test file on both runners,
and a test asserts the same outcome under each.

**4. A second journal for a test file is reconciled, not raced.** Retries and
re-runs both produce one, and `<pid>-<uuid>.va` carries no test identity to
reconcile on. **Acceptance:** a suite with a retried test file records the
attempt that finished, deterministically, and says that it did.

**5. `settled` is per-run, not per-process.** **Acceptance:** an integration
test under `vitest --watch` that edits a file and re-runs writes a second
execution record reflecting the second run.

**6. Both settles are exception-safe, and their directories are collectable.**
`try`/`finally` around the work, cleanup in the `finally`, and a run directory
named so that a later run can recognise and remove an abandoned one.
**Acceptance:** a settle that throws leaves no run directory behind, and a run
started after a killed one removes what the killed one left.

**7. Overflow and instrumentation failure are counted, not assumed away.**
Saturate the counter below the flag bit, and carry a per-run count of modules
the parser refused through to the settle, on both runners.
**Acceptance:** a module that fails to parse is visible in the run's own output,
and no count can reach `EVALUATING` by arithmetic.

**8. An observation is not destroyed before it is delivered.** Move the
`counters.delete` in `test-selection/journey.ts:233` past the point where the account is known
to be sendable, and check every `writeSync` return in
`instrumented-modules.ts`. **Acceptance:** a `report()` with no channel leaves
the journey's counters intact for the next attempt.

**9. The production path measures itself.** Journal bytes, modules per worker,
counter-array bytes, flush duration and worker peak RSS, against the 600 MB
ceiling [0043](0043-a-record-costs-what-the-run-cost.md) item 5 makes a gate —
which owns the gate script; this owns the per-worker figures it reports.
**Acceptance:** one command prints those five numbers for a run, and the
per-worker figure appears beside the whole-run figure on the metrics page.

**10. Each open item above carries an `it.todo` or a `// FIXME` at its site**
while it is open, in the form `tools/unrun.mjs` already reads.
**Acceptance:** every item in this spec that is not discharged is findable from
the code it is about, not only from this file.

## What it forecloses

**A refusal is not a failure mode until it is isolated.** The format refuses a
damaged journal correctly. Taking that refusal over a whole directory at once
converts a per-file fault into a per-run one, and that conversion — not the
refusal — is the defect.

**The reporters are not a pair of independent programs.** Vitest and Jest reset
differently, count differently, and answer an unknown module id differently, and
each difference found so far was a bug in one of them, not a choice made twice.
Behaviour that differs between the two is a defect until someone writes down why
it should not be.

**A drop is worse than a throw.** Of the three answers to an unknown module id,
the one that keeps the run alive is the one that loses a crossing and leaves the
test complete. Where the two cannot both be had, the record refuses.

**Silence is not a status.** The project's convention is a marker at the site.
A stage with ten open items and no markers in it reports itself as done.
