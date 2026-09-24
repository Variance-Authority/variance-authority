# Spec 0059 — a change runs the cases that ran it

**Missing:** a selection whose unit is the case. Every seam records which case
entered which region (`<coverage file>.cases.bin`), and `narrowByJourneys`
already reads that record. But it answers with test files, and so does
`yarn test:since`. A branch that five of two hundred cases walked runs all two
hundred. Nothing hands a runner the five.
**Built on:** `cases.ts` (the per-case record, scoped by async context),
`execution-select.ts` `narrowByJourneys` (the region-to-case join),
[ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md) (the
regions a change is charged to).

## Purpose

Running only the affected tests is the reason to record coverage at all. A test
file is the unit CI shards on. It is not the unit a person or an agent waits
on in a local loop. The record already has the finer answer, and a file-grain
selection throws it away at the last step.

## What would discharge it

**1. The join answers cases.** A region charged by 0030 or by a reading selects the
cases whose crossings entered it. `ExecutionNarrowing` carries the cases for each
selected file, each with its `SelectionReason`. A file keeps the file-grain
answer when any of the following is true: the file itself changed, the file has
no case record, the file was charged whole (a `load` verdict, an import path),
or one of its regions ran while no case was open.

**2. Code outside every case is credited to every case.** A region that ran at
collection time, in a `beforeAll`, or while the module evaluated ran before any
case was open. So every case in the file depends on it. The record already
marks such a region `loaded`; charging it selects the whole file, never the
first case that happened to load it.

**3. Each runner's own public filter, and nothing of ours.** The selected cases
are passed through the filter the runner already documents:

| Runner | Filter |
|---|---|
| Vitest | `--testNamePattern` over the full name, anchored and escaped, one alternative per case |
| Playwright | `--test-list`, a file of `path › title` lines |
| Rstest | `--testNamePattern`, as for Vitest |

No runner is patched and no reporter skips cases by itself. A person can paste
the same command, and it runs the same cases.

**4. A name is not an identity, and a collision widens.** `ExecutionTest.name`
is not unique within a file. When two cases share a full name and only one of
them was selected, the filter runs both, and `--dry-run` says so. When a
runner's pattern cannot express the set, the whole file runs and the run says
why.

**5. `test:since` chooses the grain.** File grain stays the default for the
gate. `--cases` asks for cases. `yarn verify` never narrows below the file.

**Acceptance, as scenarios:**

- A change inside a branch that one case of a 200-case file enters runs that
  one case under each of the three runners.
- A change to a function that only a `beforeAll` calls runs the whole file.
- Two cases named `renders` in one file, one of them selected: both run, and
  the dry run names the collision.
- A test file changed in the diff runs whole.

## Out of scope

**Parameterized cases.** `it.each` cases have their names formatted before
they run. Each formatted name is recorded as its own case and is selected by
that name. Nothing reconstructs the table.

**Cases that overlap in time.** Concurrent cases are attributed through async
context. A continuation that outlives its case is the case the record refuses to
guess about, and interleaving tests stay unsupported.
