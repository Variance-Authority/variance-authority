# Spec 0048 — a worker that dies leaves no trace, and the record cannot tell that from a test that touched nothing

**Missing:** the production half of the record. A crossing is observed in a
worker's memory and reaches disk exactly once, in an `afterAll`, as one
unframed buffer written straight to its final name. Every way that can fail —
the worker is killed, the write is cut short, the file is stale from a retry,
the counter wraps — arrives at the reader as the same thing a passing test that
entered nothing arrives as: a file that is absent, or a run that is empty. The
snapshot then records that absence as fact, and selection skips on it.
**Built on:** [0043](0043-a-record-costs-what-the-run-cost.md) (the per-worker
model this bounds), [0044](0044-many-writers-one-record.md) (which begins where
the journals are already on disk), [0045](0045-a-snapshot-states-its-own-age.md)
(self-description, one layer down),
[ADR-0059](../context/adr/0059-a-record-is-invalidated-by-what-could-have-answered-it.md).

## Purpose

Specs 0043 through 0047 all start from journals that exist. Nothing states what
has to be true for them to exist, and the code says less than it looks like it
does.

- The only write is `worker-source.ts:82-91`: an `afterAll` that mints
  `<pid>-<uuid>.va`, encodes the whole journal in memory, and `writeFile`s it to
  its final path. No temporary name, no rename, no fsync, no length prefix, no
  checksum. A worker killed by the OOM killer, by a segfault, or by
  `process.exit` writes nothing at all; a worker killed during the write leaves
  a prefix of a journal under a name that says it is whole.
- The reader cannot tell those apart, and does not try. `finished-files.ts:206`
  sets `recorded = false` when no journal named the file — the same state a
  skipped file reaches — and `readJournals` at `:230-241` `readdir`s the
  directory with **no extension filter** and decodes every name inside one
  `Promise.all`, so one truncated or stray file throws for the whole run and the
  error names no file.
- `run.settled` is set at `vitest.ts:310-311` and never reset, so `vitest
  --watch` records the **first** run and silently ignores every one after it.
  Jest does not have this bug: `jest-reporter.ts:71-77` re-mints the run
  directory in `onRunStart`. Two runners, one seam, opposite behaviour, and
  nothing tests it.
- Neither `settle` has a `try`/`finally`. Vitest marks the run settled before
  doing any work and `rm`s the run and case directories as plain trailing
  statements at `vitest.ts:358-359`, so any throw in between loses the run
  *and* leaves its directories behind.
- Counts are `Uint32Array` increments with bit 31 taken for `EVALUATING`
  (`instrument/index.ts:238`), and the increment does not saturate. A region
  entered 2³¹ times does not overflow into a wrong count, it overflows into the
  flag that means *this belongs to every subject*.
- `instrument()` returns `undefined` when the parse produced errors
  (`instrument/index.ts:161`) and the caller uses the original text. That is the
  right refusal, and it is silent: nothing counts it, so a run in which every
  module failed to parse and a run in which none did are the same run to a
  reader. The one check that exists, `noteAnEmptyRecord`
  (`finished-files.ts:74-84`), fires only when `instrumented === 0 &&
  testFiles > 0`, and Jest never calls it.
- `test-selection/journey.ts:233-234` deletes a journey's counters and factory at the top of
  `report()`, then returns without sending at `:253` when the channel is
  undefined. The observation is destroyed before the code discovers it cannot be
  delivered.
- `instrumented-modules.ts:165-167` ignores what `writeSync` returns on every
  inventory append, so a short write is a silently truncated frame.

None of these is marked. `FIXME`, `it.todo` and `test.todo` appear **zero**
times across `packages/sense/src/test-selection` and
`packages/sense/src/instrument`, which is not a claim that the stage is
finished; it is the absence of the project's own way of saying it is not.

## What would discharge it

**1. A journal arrives whole or does not arrive.** Encode to a temporary name,
fsync, rename — the rule `test-selection/index.ts:307` already states for the snapshot, applied
one layer earlier — and frame the journal with magic bytes and a length so a
truncated one is refused as truncated rather than decoded as short.
**Acceptance:** a test that kills a worker mid-write leaves either a complete
journal or no journal, and never a file that decodes.

**2. One bad journal costs one journal.** Filter `readdir` to the extension the
writer uses, decode each file in isolation, and report what failed by name.
**Acceptance:** a run directory containing one truncated `.va` and one stray
`.DS_Store` still settles, and the summary names the truncated file.

**3. An unrecorded file says which kind of unrecorded it is.** *Skipped*,
*crashed before it wrote*, *wrote something unreadable* and *ran and entered
nothing* are four states, and `recorded = false` is currently all four.
**Acceptance:** the reporter distinguishes them, and only the last of the four
is allowed to narrow a later selection.

**4. A second journal for a test file is reconciled, not raced.** Retries and
re-runs both produce one, and the name `<pid>-<uuid>.va` carries no test
identity to reconcile on. **Acceptance:** a suite with a retried test file
records the attempt that finished, deterministically, and says that it did.

**5. `settled` is per-run, not per-process.** **Acceptance:** an integration
test under `vitest --watch` that edits a file and re-runs writes a second
execution record reflecting the second run.

**6. Both settles are exception-safe.** `try`/`finally` around the work, the
directory cleanup in the `finally`, the settled marker set on the way out.
**Acceptance:** a settle that throws leaves no run directory behind and does not
claim a run it did not write.

**7. Overflow and instrumentation failure are counted, not assumed away.**
Saturate the counter below the flag bit, and carry a per-run count of modules
refused by the parser through to the settle. **Acceptance:** a module that
fails to parse is visible in the run's own output, and no count can reach
`EVALUATING` by arithmetic.

**8. An observation is not destroyed before it is delivered.** Move the
`counters.delete` in `test-selection/journey.ts:233` after the point where the account is
known to be sendable, and check every `writeSync` return in
`instrumented-modules.ts`. **Acceptance:** a `report()` with no channel leaves
the journey's counters intact for the next attempt.

**9. The production path measures itself.** Journal bytes, modules per worker,
counter-array bytes, flush duration and worker peak RSS, under the 600 MB
ceiling [0043](0043-a-record-costs-what-the-run-cost.md) item 5 makes a gate.
**Acceptance:** one command prints those five numbers for a run, and the
per-worker figure appears beside the whole-run figure on the metrics page.

**10. The holes carry markers.** Each item above gets an `it.todo` or a
`// FIXME` at its site while it is open. **Acceptance:** the count of status
markers in `test-selection/` and `instrument/` is not zero while this spec
exists.

## What it forecloses

**Absence is not evidence.** A missing journal is a thing that did not happen
being read as a thing that did: the test entered nothing. Every failure in this
spec ends at that one sentence, and it is the sentence that makes a wrong skip
list look like a correct one.

**The reporters are not a pair of independent programs.** Vitest and Jest
compute `complete` differently and reset differently, and each difference found
so far was a bug in one of them, not a choice made twice. Behaviour that differs
between the two is a defect until someone writes down why it should not be.

**A worker is not trusted to finish.** Nothing in this spec asks the worker to
be more careful. It asks the record to be readable by someone who assumes the
worker was killed.

**Silence is not a status.** The project's convention is a marker at the site.
A stage with ten open items and no markers in it reports itself as done.
